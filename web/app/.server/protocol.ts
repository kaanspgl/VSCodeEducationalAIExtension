import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { VIBE_PROMPT_VERSION } from "@core/vibe/prompts";
import { DATA_DIR, type Settings } from "./config";
import { modelChoice } from "./llm";
import { runTargetFor } from "./runner";
import type { StudyPart } from "./study";

/**
 * What a session is allowed to do, worked out from the settings. In a study-plan session the study's own
 * protocol applies (unless `study.strictProtocol` is false): the two conditions differ only in the four things
 * the proposal lists (explain the idea, walkthrough, predict then run, a "what if" question and a change to
 * make), so everything else Structured mode can do is switched off and both conditions write code from the
 * same prompt.
 */
export type Protocol = {
  /** The study protocol is being enforced. */
  strict: boolean;
  clarify: boolean;
  maxClarifications: number;
  /** Rounds of guiding questions in "Explain the idea" before the tutor fills in what is missing. */
  maxRoundsPerStep: number;
  requireSteps: boolean;
  allowSkipSteps: boolean;
  questionsPerChange: number;
  projectQuizQuestions: number;
  contextMaxChars: number;
  /** The prompt coach's tip under each request. */
  promptTips: boolean;
  /** Splitting a big request into a plan of steps. */
  planLargeBuilds: boolean;
  /** The "Your progress" panel (skills, concepts, Quiz me on my program). */
  progressPanel: boolean;
  /** Both conditions write code from the same system prompt. */
  sameCodePrompt: boolean;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
const flag = (cfg: Settings, key: string, fallback: boolean) => {
  const v = cfg.get<unknown>(key);
  return v === undefined || v === "" ? fallback : v === true || v === "true" || v === 1 || v === "1";
};

export function protocolFor(cfg: Settings, inStudy: boolean): Protocol {
  const strict = inStudy && flag(cfg, "study.strictProtocol", true);
  return {
    strict,
    clarify: strict ? false : flag(cfg, "learning.clarify", true),
    maxClarifications: clamp(cfg.get<number>("learning.maxClarifications") ?? 2, 0, 5),
    maxRoundsPerStep: strict ? 3 : clamp(cfg.get<number>("learning.maxRoundsPerStep") ?? 3, 1, 8),
    requireSteps: strict ? false : flag(cfg, "learning.requireSteps", false),
    allowSkipSteps: flag(cfg, "learning.allowSkipSteps", true),
    questionsPerChange: strict ? 1 : clamp(cfg.get<number>("learning.questionsPerChange") ?? 1, 1, 3),
    projectQuizQuestions: clamp(cfg.get<number>("learning.projectQuizQuestions") ?? 3, 1, 6),
    contextMaxChars: clamp(cfg.get<number>("context.maxChars") ?? 24000, 4000, 200000),
    promptTips: strict ? false : flag(cfg, "learning.promptTips", true),
    planLargeBuilds: strict ? false : flag(cfg, "learning.planLargeBuilds", true),
    progressPanel: !strict,
    sameCodePrompt: inStudy && flag(cfg, "study.sameCodePrompt", true),
  };
}

/**
 * A short fingerprint of everything that shapes what a participant gets: the prompts, the model and its
 * settings, where programs run, the protocol and the tasks. It goes in every session's first log event, so a change part-way
 * through data collection shows up as a second fingerprint. Quiz links are left out: they don't change the tool.
 */
export function studyFingerprint(cfg: Settings, parts: StudyPart[]): { hash: string; details: Record<string, unknown> } {
  const choice = modelChoice(cfg);
  const details = {
    promptVersion: VIBE_PROMPT_VERSION,
    provider: choice.provider,
    model: choice.model,
    temperature: cfg.get("temperature") ?? null,
    ollamaContextLength: choice.provider === "ollama" ? cfg.get("ollamaContextLength") ?? null : null,
    // Where programs run decides which Python the predictions and checks are made against.
    runner: runTargetFor(cfg).judge0 ? "judge0" : "local",
    protocol: protocolFor(cfg, true),
    parts: parts.map((p) => ({ concept: p.concept, minutes: p.minutes, tasks: p.tasks })),
  };
  return { hash: createHash("sha256").update(JSON.stringify(details)).digest("hex").slice(0, 10), details };
}

/** The fingerprint the researcher froze before the first session (data/frozen.json). */
export type Freeze = { hash: string; at: string; details?: Record<string, unknown> };
const FREEZE = path.join(DATA_DIR, "frozen.json");

export function readFreeze(): Freeze | undefined {
  try {
    const f = JSON.parse(fs.readFileSync(FREEZE, "utf8"));
    return typeof f?.hash === "string" && typeof f?.at === "string" ? f : undefined;
  } catch {
    return undefined;
  }
}

export function writeFreeze(f: Freeze | undefined) {
  if (!f) return fs.rmSync(FREEZE, { force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FREEZE, JSON.stringify(f, null, 2) + "\n", "utf8");
}
