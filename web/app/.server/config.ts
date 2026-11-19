import fs from "node:fs";
import path from "node:path";
import { EDUAI_DEFAULT_MODEL, EDUAI_ENDPOINT } from "./eduai";
import { GEMINI_DEFAULT_MODEL } from "./gemini";

/**
 * Settings use the same keys as the VS Code extension's settings (with or without the "vibelearner." prefix),
 * so a researcher can copy their settings.json into vibelearner.config.json. Secrets can come from the
 * environment instead. Read fresh whenever a session starts, so settings can change between participants.
 */
const DEFAULTS: Record<string, unknown> = {
  apiProvider: "ollama",
  model: "qwen3-coder:30b",
  endpoint: "",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaContextLength: 16384,
  temperature: 0.2,
  openaiApiKey: "",
  openaiBaseUrl: "https://api.openai.com/v1",
  openrouterApiKey: "",
  // Free OpenRouter models end in ":free" and come and go; the start screen lists the current ones.
  "openrouter.model": "poolside/laguna-s-2.1:free",
  "gemini.apiKey": "",
  // Google AI Studio's models (see gemini.ts): for trying the app out only, never with participants.
  "gemini.model": GEMINI_DEFAULT_MODEL,
  // UBC EduAI's campus models (see eduai.ts). The key comes from EduAI's Settings, then API Keys.
  eduaiEndpoint: EDUAI_ENDPOINT,
  eduaiApiKey: "",
  "eduai.model": EDUAI_DEFAULT_MODEL,
  // The longest answer. Prompt + this must fit the model's window (it's lowered to fit), and a request that fails
  // before the model reports is charged all of it against the key's daily tokens, so don't set it higher than needed.
  "eduai.maxTokens": 4096,
  // EduAI runs at most 2 requests from all student keys at once; more only get "busy" answers sooner.
  "eduai.maxConcurrent": 2,
  pythonPath: "",
  // Run student programs on a Judge0 server (e.g. a self-hosted one at http://127.0.0.1:2358) instead of this machine.
  judge0Url: "",
  judge0Token: "",
  // Hides the start screen's model picker (study machines).
  lockSettings: false,
  "learning.level": "guided",
  "learning.requireSteps": false,
  "learning.maxRoundsPerStep": 3,
  "learning.allowSkipSteps": true,
  "learning.clarify": true,
  "learning.maxClarifications": 2,
  "learning.questionsPerChange": 1,
  "learning.projectQuizQuestions": 3,
  "learning.promptTips": true,
  "learning.planLargeBuilds": true,
  "context.maxChars": 24000,
  // In a study-plan session: keep to the study's protocol (see protocol.ts), and write code from one prompt in both modes.
  "study.strictProtocol": true,
  "study.sameCodePrompt": true,
  // In a study-plan session, nothing can be pasted into the chat box: the task text names the input and output, so a
  // pasted request would score as a complete description (H3) without the participant describing anything.
  "study.blockPaste": true,
  // In a study-plan session, a part can't be finished before its minutes are up, so both modes get the same time on
  // each topic: Regular mode's tasks go much faster, and the quiz gains (H1) would otherwise partly measure time on task.
  "study.fixedTime": true,
};

const FROM_ENV: Record<string, string> = {
  VL_PROVIDER: "apiProvider",
  VL_MODEL: "model",
  VL_LEVEL: "learning.level",
  VL_PYTHON: "pythonPath",
  VL_JUDGE0_URL: "judge0Url",
  VL_JUDGE0_TOKEN: "judge0Token",
  // the names S378's ecosystem.config.cjs uses
  JUDGE0_URL: "judge0Url",
  JUDGE0_AUTH_TOKEN: "judge0Token",
  OLLAMA_URL: "ollamaUrl",
  OPENAI_API_KEY: "openaiApiKey",
  OPENAI_BASE_URL: "openaiBaseUrl",
  OPENROUTER_API_KEY: "openrouterApiKey",
  GEMINI_API_KEY: "gemini.apiKey",
  GEMINI_MODEL: "gemini.model",
  EDUAI_API_KEY: "eduaiApiKey",
  EDUAI_MODEL: "eduai.model",
};

export const DATA_DIR = path.resolve(process.env.VL_DATA_DIR || path.join(process.cwd(), "data"));
const CONFIG_FILE = path.resolve(process.env.VL_CONFIG || path.join(process.cwd(), "vibelearner.config.json"));

export type Settings = { get<T>(key: string): T | undefined };

export function loadSettings(): Settings {
  const values: Record<string, unknown> = { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8").replace(/^﻿/, ""));
    for (const [k, v] of Object.entries(raw)) values[k.replace(/^vibelearner\./, "")] = v;
  } catch {
    /* no config file: defaults */
  }
  for (const [env, key] of Object.entries(FROM_ENV)) {
    const v = process.env[env];
    if (v) values[key] = v;
  }
  return { get: <T>(k: string) => values[k] as T | undefined };
}

/** The environment variable overriding a setting right now, if any. */
export function envOverride(key: string): string | undefined {
  return Object.entries(FROM_ENV).find(([env, k]) => k === key && process.env[env])?.[0];
}

/** Writes settings into vibelearner.config.json and keeps the rest of it. `undefined` removes a setting. */
export function saveSettings(patch: Record<string, unknown>) {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8").replace(/^﻿/, ""));
  } catch {
    /* no config file yet */
  }
  for (const [k, v] of Object.entries(patch)) {
    delete raw[`vibelearner.${k}`];
    if (v === undefined) delete raw[k];
    else raw[k] = v;
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2) + "\n", "utf8");
}
