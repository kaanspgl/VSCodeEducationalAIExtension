import fs from "node:fs";
import path from "node:path";
import type { Level } from "~/lib/types";
import { DATA_DIR } from "./config";
import { safeName } from "./logger";

/**
 * The study plan (data/study.json): the parts a participant goes through in order. Each part teaches one
 * concept through a set of questions, with an optional quiz link (e.g. Qualtrics) before and after it.
 * The first part uses the participant's own condition and each later part switches to the other one, so
 * everyone works once with structured vibe coding and once with regular AI. Without a plan there are no
 * parts: a research session is one open-ended conversation, as before.
 */
/** `minutes` is the suggested time for the questions (0 = none): the participant sees a clock, nothing is cut off. */
export type StudyPart = { concept: string; tasks: string[]; preUrl: string; postUrl: string; minutes: number };
/** `started` is when the participant began the current part's questions (ms since 1970). */
export type Progress = { part: number; step: "pre" | "work" | "post"; task: number; started?: number };

const PLAN = path.join(DATA_DIR, "study.json");
const progressFile = (code: string) => path.join(DATA_DIR, "progress", `${safeName(code)}.json`);
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

export function readPlan(): StudyPart[] {
  return readStudy().parts;
}

/** The parts, and the link to a closing questionnaire shown after the last part (optional). */
export function readStudy(): { parts: StudyPart[]; endUrl: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(PLAN, "utf8"));
    const endUrl = String(raw?.endUrl ?? "").trim();
    return { parts: cleanPlan(Array.isArray(raw?.parts) ? raw.parts : []), endUrl: isUrl(endUrl) ? endUrl : "" };
  } catch {
    return { parts: [], endUrl: "" };
  }
}

/** Keeps only parts that have a concept and at least one question; drops links that aren't web addresses. */
export function cleanPlan(parts: any[]): StudyPart[] {
  return parts.map((p) => ({
    concept: String(p?.concept ?? "").trim().slice(0, 80),
    tasks: (Array.isArray(p?.tasks) ? p.tasks : []).map((t: unknown) => String(t).trim().slice(0, 2000)).filter(Boolean).slice(0, 30),
    preUrl: isUrl(String(p?.preUrl ?? "").trim()) ? String(p.preUrl).trim() : "",
    postUrl: isUrl(String(p?.postUrl ?? "").trim()) ? String(p.postUrl).trim() : "",
    minutes: Math.min(180, Math.max(0, Math.round(Number(p?.minutes) || 0))),
  })).filter((p) => p.concept && p.tasks.length).slice(0, 6);
}

export function writePlan(parts: StudyPart[], endUrl = "") {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${PLAN}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ parts, endUrl: isUrl(endUrl.trim()) ? endUrl.trim() : "" }, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, PLAN);
}

/** Where a participant is in the plan, kept on disk so they carry on after a break or a server restart. */
export function readProgress(code: string): Progress {
  try {
    const p = JSON.parse(fs.readFileSync(progressFile(code), "utf8"));
    return {
      part: Math.max(0, Number(p.part) || 0), step: ["pre", "work", "post"].includes(p.step) ? p.step : "pre", task: Math.max(0, Number(p.task) || 0),
      started: Number(p.started) || undefined,
    };
  } catch {
    return { part: 0, step: "pre", task: 0 };
  }
}

export function writeProgress(code: string, p: Progress) {
  fs.mkdirSync(path.dirname(progressFile(code)), { recursive: true });
  fs.writeFileSync(progressFile(code), JSON.stringify(p) + "\n", "utf8");
}

export function hasProgress(code: string): boolean {
  return fs.existsSync(progressFile(code));
}

/** Sends a participant back to the start of the plan. Logs and files stay. */
export function resetProgress(code: string) {
  fs.rmSync(progressFile(code), { force: true });
}

/** Part 1 runs in the participant's own condition; each part after it flips between structured and regular. */
export function levelForPart(first: Level, part: number): Level {
  return part % 2 === 0 ? first : first === "off" ? "guided" : "off";
}

/** The quiz link with the participant code, part and pre/post added, so the survey tool can record who answered. */
export function quizUrl(url: string, code: string, part: number, when: "pre" | "post" | "end"): string {
  try {
    const u = new URL(url);
    u.searchParams.set("pid", code);
    if (when !== "end") u.searchParams.set("part", String(part + 1));
    u.searchParams.set("when", when);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * The COSC 449 study: two Python concepts, about 12 minutes of questions each. The quiz links are left empty:
 * paste the Qualtrics links for each quiz on the researcher page. The third question in each part is for
 * participants who finish early.
 */
export const EXAMPLE_PLAN: StudyPart[] = [
  {
    concept: "Loops",
    minutes: 12,
    preUrl: "",
    postUrl: "",
    tasks: [
      "Write a Python program that adds up all the whole numbers from 1 to 50 and prints the total.",
      "Write a Python program that counts how many of the numbers from 1 to 100 can be divided by 7 with nothing left over, and prints the count.",
      "If you have time: write a Python program that prints the 6 times table from 6 x 1 to 6 x 10, one line for each (for example: 6 x 1 = 6).",
    ],
  },
  {
    concept: "Lists",
    minutes: 12,
    preUrl: "",
    postUrl: "",
    tasks: [
      "Write a Python program that stores these test scores in a list: 72, 85, 90, 64, 88. It should find the highest score and print it, without using the built-in max().",
      "Using the same list of scores (72, 85, 90, 64, 88), write a Python program that counts how many scores are 80 or higher and prints the count.",
      "If you have time: write a Python program that builds a new list holding only the scores below 80 from that list, and prints the new list.",
    ],
  },
];
