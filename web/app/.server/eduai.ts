/**
 * UBC EduAI's completion API, as EduAI's guide for API users describes it: POST /api/completion with the key in
 * `x-api-key`, campus models only (`vllm:...`), one answer per request and nothing remembered between requests.
 *
 * Its limits shape this client:
 * - At most 2 requests from all student keys together run at once, so this server keeps to `maxConcurrent` of its
 *   own and waits out a "busy" answer (Retry-After) a few times before giving up.
 * - The prompt plus maxTokens must fit the model's context window, and one token over is refused, so maxTokens is
 *   lowered to fit before sending, and a request that can't fit isn't sent.
 * - The key's allowance (by default 200 requests and 200,000 tokens in any 24 hours) is shared by every participant.
 *
 * No imports, so the tests can load it without the app.
 */

export const EDUAI_ENDPOINT = "https://my.eduai.ok.ubc.ca/api/completion";
/** The largest window, so a whole small project, the instructions and the conversation fit. */
export const EDUAI_DEFAULT_MODEL = "vllm:qwen3.8-27b-instruct";

/** Context windows (prompt + answer), as EduAI measured them on 2026-10-23. Other models aren't checked here. */
export const EDUAI_CONTEXT: Record<string, number> = {
  "vllm:qwen3.5-2b-instruct": 16384,
  "vllm:qwen3.5-9b-instruct": 16384,
  "vllm:qwen3.8-27b-instruct": 65536,
};

/** EduAI's cap on maxTokens for every model. */
const MAX_TOKENS_CAP = 16384;
/** An answer with code in it needs at least this much room; below it, refuse rather than send a cut-off answer. */
const MIN_ANSWER = 1024;
/** Give up after this many attempts, and never wait longer than this for one retry or in total. */
const ATTEMPTS = 4;
const MAX_WAIT_S = 30;
const MAX_TOTAL_WAIT_S = 90;

export type EduAIMessage = { role: "user" | "assistant"; content: string };

export type EduAIRequest = {
  endpoint?: string;
  apiKey: string;
  model: string;
  system?: string;
  messages: EduAIMessage[];
  /** The longest answer wanted. Lowered to fit the model's context window. */
  maxTokens: number;
  temperature?: number;
  /** Requests this server sends to EduAI at the same time. */
  maxConcurrent?: number;
};

export type EduAIReply = {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  /** "length" when the answer was cut off by maxTokens. */
  finishReason?: string;
  maxTokens: number;
};

type Deps = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> };

export class EduAIError extends Error {
  readonly status?: number;
  readonly code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "EduAIError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Prompt tokens are guessed at 1 per 3 characters (EduAI's rule of thumb is 4 for English, and code takes more),
 * plus the chat format's own tokens, and 10% of the window is left spare, as EduAI's guide advises.
 */
export function fitMaxTokens(model: string, promptChars: number, wanted: number): number {
  const want = Math.min(Math.max(1, Math.round(wanted) || 1), MAX_TOKENS_CAP);
  const window = EDUAI_CONTEXT[model];
  if (!window) return want;
  const promptTokens = Math.ceil(promptChars / 3) + 300;
  const room = Math.floor(window * 0.9) - promptTokens;
  if (room >= want) return want;
  if (room >= Math.min(want, MIN_ANSWER)) return room;
  throw new EduAIError(
    `This request is too long for ${model}: about ${promptTokens.toLocaleString("en")} tokens of its ${window.toLocaleString("en")}-token window. ` +
      (window < EDUAI_CONTEXT[EDUAI_DEFAULT_MODEL] ? `Use ${EDUAI_DEFAULT_MODEL}, or lower context.maxChars.` : "Lower context.maxChars."),
    400,
    "CONTEXT_LENGTH_EXCEEDED",
  );
}

// This server's own share of EduAI's two-at-a-time limit. A freed slot goes straight to the next caller in line.
let running = 0;
const waiting: (() => void)[] = [];

function acquire(max: number): Promise<void> {
  if (running < max) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

export async function eduaiComplete(req: EduAIRequest, deps: Deps = {}): Promise<EduAIReply> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  if (!req.apiKey) throw new EduAIError("EduAI API key missing. Set EDUAI_API_KEY (or eduaiApiKey in vibelearner.config.json).");
  if (!req.model.startsWith("vllm:")) {
    throw new EduAIError(`EduAI only runs campus models, whose names start with "vllm:" (not "${req.model}"). Set eduai.model, e.g. to ${EDUAI_DEFAULT_MODEL}.`);
  }

  const promptChars = (req.system?.length ?? 0) + req.messages.reduce((n, m) => n + m.content.length, 0);
  const maxTokens = fitMaxTokens(req.model, promptChars, req.maxTokens);
  const endpoint = req.endpoint || EDUAI_ENDPOINT;
  const body = JSON.stringify({
    model: req.model,
    // Required, and always empty: campus models need no provider key.
    apiKeys: {},
    ...(req.system ? { systemPrompt: req.system } : {}),
    messages: req.messages,
    maxTokens,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    streaming: false,
  });
  const max = Math.max(1, Number(req.maxConcurrent) || 2);

  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    await acquire(max);
    let status: number;
    let raw: string;
    let retryAfter: number | undefined;
    try {
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": req.apiKey },
        body,
      });
      status = res.status;
      raw = await res.text();
      const ra = Number(res.headers.get("Retry-After"));
      retryAfter = Number.isFinite(ra) && ra >= 0 && res.headers.has("Retry-After") ? ra : undefined;
    } catch (err: any) {
      throw new EduAIError(`Couldn't reach EduAI at ${endpoint}: ${err?.cause?.code || err?.message || err}. The server must be on UBC's network.`);
    } finally {
      release();
    }

    let data: any = {};
    try {
      data = JSON.parse(raw);
    } catch {
      /* not JSON: an error page from a proxy */
    }

    if (status === 200) {
      if (typeof data?.content !== "string") throw new EduAIError(`EduAI answered without any content: ${raw.slice(0, 200)}`, status);
      if (data.finishReason === "length") console.warn(`[eduai] ${req.model} hit maxTokens (${maxTokens}): the answer was cut off.`);
      return { text: data.content, usage: data.usage, finishReason: data.finishReason, maxTokens };
    }

    const code = typeof data?.code === "string" ? data.code : undefined;
    // Retry only what can work later: limits, busy servers, a model error. Never a request that is wrong as sent.
    const retryable = status === 429 || status === 503 || data?.retryable === true;
    const wait = retryAfter ?? 5 * 2 ** (attempt - 1);
    if (retryable && attempt < ATTEMPTS && wait <= MAX_WAIT_S && waited + wait <= MAX_TOTAL_WAIT_S) {
      console.warn(`[eduai] ${status} ${code ?? data?.error ?? ""}: waiting ${wait} s (attempt ${attempt} of ${ATTEMPTS})`);
      waited += wait;
      await sleep(wait * 1000);
      continue;
    }
    throw new EduAIError(explain(status, code, data, raw, req.model, retryAfter), status, code);
  }
}

/** What went wrong and what to do, in words a researcher (or a participant, who sees it too) can act on. */
function explain(status: number, code: string | undefined, data: any, raw: string, model: string, retryAfter?: number): string {
  const detail = String(data?.error || data?.message || code || raw.slice(0, 200) || "no details").trim();
  if (code === "CONTEXT_LENGTH_EXCEEDED") {
    return `EduAI: this request is too long for ${model}'s context window. Lower context.maxChars or eduai.maxTokens, or use ${EDUAI_DEFAULT_MODEL}.`;
  }
  if (status === 401) return "EduAI didn't accept the API key: it is wrong, deleted, expired or disabled. Check EDUAI_API_KEY.";
  if (code === "API_ACCESS_MODEL_NOT_ALLOWED") return `EduAI doesn't allow the model "${model}" with this key. Use a campus model (vllm:...).`;
  if (status === 403) return `EduAI: this account has no active API access (${detail}). Ask the EduAI administrator who gave the access.`;
  if (code === "API_ACCESS_LIMIT") {
    const which = data?.limit ? `${data.limit} ` : "";
    const when = retryAfter ? ` More frees up in about ${retryAfter < 120 ? `${retryAfter} s` : `${Math.ceil(retryAfter / 60)} min`}.` : "";
    return `EduAI's daily ${which}limit for this study's key is used up: it counts the last 24 hours.${when} The EduAI administrator can raise it.`;
  }
  if (status === 429 || status === 503) return "EduAI's campus models are busy right now (course chat comes first). Wait a minute and try again.";
  if (status === 504) return "EduAI stopped the request after 5 minutes. Try again, or ask for something smaller.";
  if (status === 400 || status === 422) return `EduAI refused the request (${status}): ${detail}`;
  return `EduAI Error (${status}): ${detail}`;
}
