import fs from "node:fs";
import path from "node:path";

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
  "gemini.model": "gemini-2.5-flash",
  eduaiEndpoint: "https://eduai.ok.ubc.ca/api/chat",
  eduaiApiKey: "",
  courseCode: "DEMO101",
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
  EDUAI_API_KEY: "eduaiApiKey",
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
