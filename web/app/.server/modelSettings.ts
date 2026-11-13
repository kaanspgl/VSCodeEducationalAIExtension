import type { ModelSettings, ProviderInfo } from "~/lib/types";
import { envOverride, loadSettings, saveSettings, type Settings } from "./config";
import { modelChoice, modelKeyFor } from "./llm";

/**
 * The start screen's model picker. Only the computer running the server can use it (a participant on another
 * machine never sees it), and `lockSettings` turns it off for study machines. Keys are written to
 * vibelearner.config.json, which git ignores.
 */
const KEY_SETTING: Record<string, string> = { openrouter: "openrouterApiKey", gemini: "gemini.apiKey", openai: "openaiApiKey", eduai: "eduaiApiKey" };
const LABELS: Record<string, string> = { ollama: "Ollama (on this computer)", openrouter: "OpenRouter", gemini: "Google Gemini", openai: "OpenAI-compatible", eduai: "EduAI", mock: "Mock (canned replies)" };
const SHOWN = ["ollama", "openrouter", "gemini"];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function settingsAllowed(request: Request): boolean {
  const lock = String(loadSettings().get("lockSettings") ?? "");
  if (lock === "true" || lock === "1") return false;
  // Behind a reverse proxy (Apache on a UBC server) every request reaches the app addressed to "localhost", so a
  // request the proxy passed on (it adds these headers) never counts as the server's own computer.
  if (["x-forwarded-for", "x-forwarded-host", "forwarded"].some((h) => request.headers.has(h))) return false;
  if (!LOCAL_HOSTS.has(new URL(request.url).hostname)) return false;
  // A page from another site can't change settings through the browser.
  const origin = request.headers.get("Origin");
  return !origin || LOCAL_HOSTS.has(new URL(origin).hostname);
}

export async function readModelSettings(): Promise<ModelSettings> {
  const cfg = loadSettings();
  const { provider } = modelChoice(cfg);
  const ids = SHOWN.includes(provider) ? SHOWN : [...SHOWN, provider];
  const [installed, free] = await Promise.all([ollamaModels(cfg), openRouterFree()]);
  const providers = ids.map((id): ProviderInfo => {
    const model = String(cfg.get(modelKeyFor(id)) || cfg.get("model") || "");
    const key = KEY_SETTING[id] ? String(cfg.get(KEY_SETTING[id]) ?? "") : "";
    const env = ["apiProvider", modelKeyFor(id), KEY_SETTING[id]].map((k) => k && envOverride(k)).filter((v): v is string => !!v);
    const info: ProviderInfo = { id, label: LABELS[id] ?? id, model, needsKey: !!KEY_SETTING[id], keyHint: key ? key.slice(-4) : undefined, suggestions: [], env };
    if (id === "ollama") {
      info.suggestions = installed ?? [];
      info.note = !installed ? `Ollama isn't running at ${ollamaBase(cfg)}. Start Ollama, or pick another provider.`
        : !installed.includes(model) ? `${model} isn't installed in Ollama. Pick an installed model, or run: ollama pull ${model}` : undefined;
    } else if (id === "openrouter") {
      info.suggestions = free;
      info.keyUrl = "https://openrouter.ai/keys";
      info.note = "Models ending in :free cost nothing; you only need a free account and its key. They have a daily request limit, and VibeLearner makes a few requests per message.";
    } else if (id === "gemini") {
      info.suggestions = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"];
      info.keyUrl = "https://aistudio.google.com/apikey";
      info.note = "Google AI Studio keys have a free tier.";
    }
    return info;
  });
  return { available: true, provider, providers };
}

/** Saves the picked provider, its model and (if given) a new key. Returns an error message, or undefined. */
export function writeModelSettings(body: any): string | undefined {
  const provider = String(body?.provider ?? "");
  const model = String(body?.model ?? "").trim();
  const key = String(body?.key ?? "").trim();
  if (!LABELS[provider]) return "Unknown provider.";
  if (!/^[\w.:/@+-]{1,200}$/.test(model)) return "That doesn't look like a model name.";
  if (key && (!KEY_SETTING[provider] || !/^\S{8,400}$/.test(key))) return "That doesn't look like an API key.";
  saveSettings({ apiProvider: provider, [modelKeyFor(provider)]: model, ...(key ? { [KEY_SETTING[provider]]: key } : {}) });
  return undefined;
}

function ollamaBase(cfg: Settings): string {
  return String(cfg.get("ollamaUrl") ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
}

async function getJson(url: string, ms: number): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Installed Ollama models, or undefined when Ollama isn't reachable. */
async function ollamaModels(cfg: Settings): Promise<string[] | undefined> {
  try {
    const data = await getJson(`${ollamaBase(cfg)}/api/tags`, 2000);
    return (data?.models ?? []).map((m: any) => String(m?.name || m?.model || "")).filter(Boolean);
  } catch {
    return undefined;
  }
}

let freeCache: { at: number; ids: string[] } | undefined;
/** OpenRouter's current free text models (its public list needs no key), cached for an hour. */
async function openRouterFree(): Promise<string[]> {
  if (freeCache && Date.now() - freeCache.at < 3600_000) return freeCache.ids;
  try {
    const { data } = await getJson("https://openrouter.ai/api/v1/models", 5000);
    const ids = (data as any[])
      .filter((m) => (m.id.endsWith(":free") || m.id === "openrouter/free") && (m.architecture?.output_modalities ?? ["text"]).includes("text") && !/safety|guard/i.test(m.id))
      .map((m) => String(m.id))
      .sort();
    freeCache = { at: Date.now(), ids };
    return ids;
  } catch {
    // Offline (e.g. a closed lab network): the model can still be typed in.
    return freeCache?.ids ?? [];
  }
}
