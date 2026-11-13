import type { Settings } from "./config";
import { mockReply } from "./mock";

export type ChatMsg = { role: "user" | "assistant"; content: string };

type CallArgs = {
  model: string;
  prompt: string;
  system?: string;
  /** Earlier turns of the conversation (oldest first). `prompt` is the newest user turn. */
  history?: ChatMsg[];
  /** Overrides the configured temperature (e.g. 0 for judge calls). */
  temperature?: number;
  settings: Settings;
};

export type CallResult = {
  text: string;
  provider: string;
  /** Wall-clock time spent waiting on the model, kept separate from student time in study logs. */
  ms: number;
};

/** The setting naming a provider's model: OpenRouter and Gemini have their own, the rest share "model". */
export function modelKeyFor(provider: string): string {
  return ({ openrouter: "openrouter.model", gemini: "gemini.model" } as Record<string, string>)[provider] ?? "model";
}

/** The provider in use and the model it runs: what gets called, and what study logs record. */
export function modelChoice(cfg: Settings): { provider: string; model: string } {
  const base = String(cfg.get("model") || "qwen3-coder:30b");
  let provider = String(cfg.get("apiProvider") ?? "ollama").toLowerCase();
  if (provider === "auto") provider = base.startsWith("gemini") ? "gemini" : base.startsWith("eduai") ? "eduai" : "ollama";
  return { provider, model: String(cfg.get(modelKeyFor(provider)) || base) };
}

/** The model call, server-side only: API keys never reach the browser. Same providers as the extension, plus OpenRouter, OpenAI-compatible servers and a mock. */
export async function callBackend(args: CallArgs): Promise<CallResult> {
  const started = Date.now();
  const { text, provider } = await route(args);
  return { text, provider, ms: Date.now() - started };
}

async function route(args: CallArgs): Promise<{ text: string; provider: string }> {
  const cfg = args.settings;
  const history = args.history ?? [];
  const temperature = args.temperature ?? cfg.get<number>("temperature") ?? 0.2;
  const choice = modelChoice(cfg);
  const provider = choice.provider;
  const model = args.model || choice.model;

  if (provider === "mock") return { text: await mockReply(args.system ?? "", args.prompt), provider };

  if (provider === "eduai") {
    const apiKey = cfg.get<string>("eduaiApiKey") || "";
    if (!apiKey) throw new Error("EduAI API key missing.");
    const res = await fetch(cfg.get<string>("eduaiEndpoint") || "https://eduai.ok.ubc.ca/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        messages: [
          ...(args.system ? [{ role: "user", content: `[Instructions]\n${args.system}` }] : []),
          ...history,
          { role: "user", content: args.prompt },
        ],
        model,
        courseCode: cfg.get<string>("courseCode") || "DEMO101",
      }),
    });
    if (!res.ok) throw new Error(`EduAI Error: ${res.status}`);
    const data: any = await res.json();
    return { text: data?.response || "", provider };
  }

  if (provider === "gemini") {
    const key = cfg.get<string>("gemini.apiKey") || "";
    if (!key) throw new Error("Gemini API key missing.");
    const body: any = {
      contents: [
        ...history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
        { role: "user", parts: [{ text: args.prompt }] },
      ],
      generationConfig: { temperature },
    };
    if (args.system) body.systemInstruction = { role: "system", parts: [{ text: args.system }] };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Gemini Error (${res.status}): ${await res.text()}`);
    const json: any = await res.json();
    return { text: json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "", provider };
  }

  const messages = [
    ...(args.system ? [{ role: "system", content: args.system }] : []),
    ...history,
    { role: "user", content: args.prompt },
  ];

  if (provider === "openai" || provider === "openrouter") {
    // OpenRouter, or any OpenAI-compatible server (OpenAI, vLLM, LM Studio, ...): set openaiBaseUrl.
    const or = provider === "openrouter";
    const key = cfg.get<string>(or ? "openrouterApiKey" : "openaiApiKey") || "";
    if (or && !key) throw new Error("OpenRouter API key missing. Add one on the start screen under Model, or set OPENROUTER_API_KEY.");
    const base = or ? "https://openrouter.ai/api/v1" : String(cfg.get("openaiBaseUrl") || "https://api.openai.com/v1").replace(/\/+$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, messages, temperature }),
    });
    if (!res.ok) throw new Error(or ? openRouterError(res.status, await res.text()) : `OpenAI Error (${res.status}): ${await res.text()}`);
    const json: any = await res.json();
    // OpenRouter reports some upstream failures inside a 200 response.
    if (json?.error) throw new Error(or ? openRouterError(Number(json.error.code) || 502, JSON.stringify(json)) : `OpenAI Error: ${JSON.stringify(json.error)}`);
    return { text: json?.choices?.[0]?.message?.content ?? "", provider };
  }

  // A typo in apiProvider shouldn't quietly switch the study to another model.
  if (provider !== "ollama") throw new Error(`Unknown apiProvider "${provider}". Use ollama, openrouter, gemini, openai, eduai or mock.`);
  const base = String(cfg.get("ollamaUrl") ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
  const endpoint = String(cfg.get("endpoint") ?? "").trim() || `${base}/api/chat`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        // Streamed: a long answer keeps the connection alive instead of hitting fetch's five-minute limit.
        stream: true,
        // Ollama defaults to a 4096-token window and silently drops the start of longer prompts (our
        // instructions). Keep this fixed across calls: changing it makes Ollama reload the model.
        options: { temperature, num_ctx: cfg.get<number>("ollamaContextLength") ?? 16384 },
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Ollama Error: ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ""}`);
    }
    return { text: await readOllamaReply(res), provider: "ollama" };
  } catch (err: any) {
    throw new Error(`Ollama connection failed. Is 'ollama serve' running? Error: ${err.message}`);
  }
}

/** OpenRouter's error message, plus what to do about the usual ones. */
function openRouterError(status: number, body: string): string {
  let msg = body;
  try {
    msg = JSON.parse(body)?.error?.message || body;
  } catch {
    /* not JSON */
  }
  const hint = status === 401 ? " Check the API key on the start screen."
    : status === 402 ? " This model isn't free: pick one that ends in :free."
    : status === 404 ? " Pick another model on the start screen: free models come and go."
    : status === 429 ? " Free models allow only so many requests a minute and a day: wait a bit or try another model."
    : "";
  return `OpenRouter Error (${status}): ${msg}${hint}`;
}

/** Collects a streamed (newline-delimited JSON) Ollama chat reply; falls back to a single JSON body. */
async function readOllamaReply(res: Response): Promise<string> {
  if (!res.body) {
    const data: any = await res.json();
    return data?.message?.content || data?.response || "";
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let text = "";
  const take = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line);
    if (chunk.error) throw new Error(String(chunk.error));
    text += chunk.message?.content ?? chunk.response ?? "";
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffered.indexOf("\n")) >= 0) {
      take(buffered.slice(0, nl));
      buffered = buffered.slice(nl + 1);
    }
  }
  take(buffered + decoder.decode());
  return text;
}
