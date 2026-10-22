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
  "gemini.apiKey": "",
  "gemini.model": "gemini-2.0-flash-lite-preview-02-05",
  eduaiEndpoint: "https://eduai.ok.ubc.ca/api/chat",
  eduaiApiKey: "",
  courseCode: "DEMO101",
  pythonPath: "",
  "learning.level": "guided",
  "learning.requireSteps": false,
  "learning.maxRoundsPerStep": 3,
  "learning.allowSkipSteps": true,
  "learning.clarify": true,
  "learning.maxClarifications": 2,
  "learning.questionsPerChange": 1,
  "learning.projectQuizQuestions": 3,
  "context.maxChars": 24000,
};

const FROM_ENV: Record<string, string> = {
  VL_PROVIDER: "apiProvider",
  VL_MODEL: "model",
  VL_LEVEL: "learning.level",
  VL_PYTHON: "pythonPath",
  OLLAMA_URL: "ollamaUrl",
  OPENAI_API_KEY: "openaiApiKey",
  OPENAI_BASE_URL: "openaiBaseUrl",
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
