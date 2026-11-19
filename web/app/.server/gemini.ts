/**
 * Google's Gemini API with a Google AI Studio key: POST models/<model>:generateContent, the key in `x-goog-api-key`.
 *
 * Meant for trying VibeLearner out, not for participants: on the free tier Google may use what is sent to improve
 * its products (and people may read it), and the study proposal keeps participants' data off third-party AI providers.
 *
 * The free tier shapes this client:
 * - Models are often busy (503) or slow to start, and a request can hang for minutes, so each attempt has a time
 *   limit and busy answers are retried a few times within an overall limit.
 * - Per-minute limits (429) are waited out, using the delay Google suggests; a used-up daily limit is not retried.
 * - Google retires old models for new keys (404), so the error names the setting to change.
 *
 * No imports, so the tests can load it without the app.
 */

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/**
 * On a free key on 2026-11-19 the full Flash models were often busy (503) or timed out, while both Flash-Lite models
 * answered and judged all 12 Step 1 test cases as expected. This one also ran a whole Structured task in the app.
 */
export const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite";
/** Offered on the start screen. Others can be typed in. */
export const GEMINI_SUGGESTED = [GEMINI_DEFAULT_MODEL, "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"];

const ATTEMPTS = 4;
/** One attempt's time limit, and the most one call may take with its retries. */
const ATTEMPT_MS = 90_000;
const TOTAL_MS = 180_000;
const MAX_WAIT_S = 30;

export type GeminiMessage = { role: "user" | "assistant"; content: string };

export type GeminiRequest = {
  apiKey: string;
  model: string;
  system?: string;
  messages: GeminiMessage[];
  temperature?: number;
};

type Deps = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number };

export class GeminiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

export async function geminiComplete(req: GeminiRequest, deps: Deps = {}): Promise<string> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  if (!req.apiKey) throw new GeminiError("Gemini API key missing. Set GEMINI_API_KEY (or gemini.apiKey in vibelearner.config.json).");

  const body: any = {
    contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    ...(req.temperature !== undefined ? { generationConfig: { temperature: req.temperature } } : {}),
  };
  if (req.system) body.systemInstruction = { role: "system", parts: [{ text: req.system }] };
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(req.model)}:generateContent`;
  const deadline = now() + TOTAL_MS;

  for (let attempt = 1; ; attempt++) {
    const limit = Math.max(1000, Math.min(ATTEMPT_MS, deadline - now()));
    let status = 0;
    let raw = "";
    let failure: string | undefined;
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": req.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(limit),
      });
      status = res.status;
      raw = await res.text();
    } catch (err: any) {
      failure = err?.name === "TimeoutError" || err?.name === "AbortError"
        ? `no answer within ${Math.round(limit / 1000)} s`
        : `couldn't reach Google (${err?.cause?.code || err?.message || err})`;
    }

    let data: any = {};
    try {
      data = JSON.parse(raw);
    } catch {
      /* not JSON */
    }
    if (status === 200) return replyText(data, req.model);

    const perDay = status === 429 && /per ?day/i.test(raw);
    const retryable = failure !== undefined || (status === 429 && !perDay) || status === 500 || status === 503 || status === 504;
    const wait = retryDelay(data) ?? 3 * 2 ** (attempt - 1);
    if (retryable && attempt < ATTEMPTS && wait <= MAX_WAIT_S && now() + wait * 1000 + 10_000 < deadline) {
      console.warn(`[gemini] ${req.model}: ${failure ?? status}: waiting ${wait} s (attempt ${attempt} of ${ATTEMPTS})`);
      await sleep(wait * 1000);
      continue;
    }
    throw new GeminiError(explain(status, data, raw, req.model, failure, perDay), status || undefined);
  }
}

/** The answer's text. Thinking models can return their thoughts as extra parts, which are left out. */
function replyText(data: any, model: string): string {
  const c = data?.candidates?.[0];
  const text = (c?.content?.parts ?? [])
    .filter((p: any) => !p?.thought && typeof p?.text === "string")
    .map((p: any) => p.text)
    .join("");
  const why = data?.promptFeedback?.blockReason || c?.finishReason;
  if (text) {
    if (why === "MAX_TOKENS") console.warn(`[gemini] ${model} hit its output limit: the answer was cut off.`);
    return text;
  }
  // Blocked or stopped for a reason other than finishing: say so instead of handing back an empty answer.
  if (why && why !== "STOP") throw new GeminiError(`Gemini (${model}) gave no answer (${why}). Try again, or set gemini.model to another model.`, 200);
  return "";
}

/** Google's suggested wait (a RetryInfo detail such as "12s"), in whole seconds. */
function retryDelay(data: any): number | undefined {
  const info = (data?.error?.details ?? []).find((d: any) => String(d?.["@type"] ?? "").endsWith("RetryInfo"));
  const s = parseFloat(String(info?.retryDelay ?? ""));
  return Number.isFinite(s) && s >= 0 ? Math.ceil(s) : undefined;
}

/** What went wrong and what to do, in words a researcher can act on. */
function explain(status: number, data: any, raw: string, model: string, failure: string | undefined, perDay: boolean): string {
  const detail = String(data?.error?.message || raw.slice(0, 200) || "no details").trim();
  if (failure) return `Gemini (${model}) didn't answer: ${failure}. Google's free models are often busy: try again in a minute, or set gemini.model to another model.`;
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(raw)) return "Google didn't accept the Gemini API key. Check GEMINI_API_KEY (or gemini.apiKey).";
  if (status === 403) return `Google refused this Gemini API key (${detail}). Check that the key is from Google AI Studio and allowed to use the Gemini API.`;
  if (status === 404) return `Gemini has no model "${model}" for this key: Google retires old models. Set gemini.model (or GEMINI_MODEL), e.g. to ${GEMINI_DEFAULT_MODEL}. Google said: ${detail}`;
  if (perDay) return `The free daily limit for ${model} is used up; it resets at midnight Pacific time. Wait, or set gemini.model to another model, which has its own limit.`;
  if (status === 429) return `Gemini (${model}) allows only so many requests a minute on the free tier, and they're used up. Wait a minute and try again.`;
  if (status === 500 || status === 503 || status === 504) return `Gemini (${model}) is busy right now (${status}). Google's free models often are: try again in a minute, or set gemini.model to another model.`;
  return `Gemini Error (${status}): ${detail}`;
}
