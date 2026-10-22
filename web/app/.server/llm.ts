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

/** The model call, server-side only: API keys never reach the browser. Same providers as the extension, plus OpenAI-compatible and a mock. */
export async function callBackend(args: CallArgs): Promise<CallResult> {
  const started = Date.now();
  const { text, provider } = await route(args);
  return { text, provider, ms: Date.now() - started };
}

async function route(args: CallArgs): Promise<{ text: string; provider: string }> {
  const cfg = args.settings;
  const history = args.history ?? [];
  const temperature = args.temperature ?? cfg.get<number>("temperature") ?? 0.2;
  let provider = String(cfg.get("apiProvider") ?? "ollama").toLowerCase();
  const model = args.model || String(cfg.get("model") ?? "qwen3-coder:30b");
  if (provider === "auto") provider = model.startsWith("gemini") ? "gemini" : model.startsWith("eduai") ? "eduai" : "ollama";

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
    const geminiModel = cfg.get<string>("gemini.model") || model;
    const body: any = {
      contents: [
        ...history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
        { role: "user", parts: [{ text: args.prompt }] },
      ],
      generationConfig: { temperature },
    };
    if (args.system) body.systemInstruction = { role: "system", parts: [{ text: args.system }] };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`, {
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

  if (provider === "openai") {
    // Any OpenAI-compatible server (OpenAI, vLLM, LM Studio, ...): set openaiBaseUrl.
    const key = cfg.get<string>("openaiApiKey") || "";
    const base = String(cfg.get("openaiBaseUrl") || "https://api.openai.com/v1").replace(/\/+$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, messages, temperature }),
    });
    if (!res.ok) throw new Error(`OpenAI Error (${res.status}): ${await res.text()}`);
    const json: any = await res.json();
    return { text: json?.choices?.[0]?.message?.content ?? "", provider };
  }

  // Ollama (default)
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
