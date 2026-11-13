import cp from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createCookie } from "react-router";
import type { Level } from "~/lib/types";
import { DATA_DIR, loadSettings } from "./config";
import { readConsent } from "./consent";
import { callBackend, modelChoice } from "./llm";
import { safeName } from "./logger";
import { protocolFor, readFreeze, studyFingerprint } from "./protocol";
import { readRoster } from "./roster";
import { interpreterFor, runProgram, runTargetFor } from "./runner";
import { EXAMPLE_PLAN, hasProgress, readPlan, readProgress, readStudy } from "./study";

/**
 * The researcher's side: one password (the VL_ADMIN_PASSWORD environment variable; the admin page is off
 * without it), a signed cookie once it has been entered, and a summary of every participant's log.
 */
const LOG_DIR = path.join(DATA_DIR, "study_logs");
const sha = (s: string) => createHash("sha256").update(s).digest();

// ADMIN_PASSWORD: the name S378's ecosystem.config.cjs uses
export const adminPassword = () => (process.env.VL_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD)?.trim() || undefined;
const embeddedDemo = () => ["1", "true"].includes(String(process.env.VL_EMBEDDED ?? "").toLowerCase());

// Signed with a key derived from the password, so changing the password signs everyone out.
function cookie() {
  return createCookie("vl_admin", {
    // Strict, except in an embedded demo (VL_EMBEDDED), where the page lives in another site's frame.
    httpOnly: true, path: "/", maxAge: 60 * 60 * 12, ...(embeddedDemo() ? ({ sameSite: "none", secure: true } as const) : ({ sameSite: "strict" } as const)),
    secrets: [sha(`vl-admin-cookie:${adminPassword() ?? ""}`).toString("hex")],
  });
}

export async function isAdmin(request: Request): Promise<boolean> {
  if (!adminPassword()) return false;
  return (await cookie().parse(request.headers.get("Cookie"))) === "admin";
}

// Wrong guesses are slowed down: after 5 in a row, sign-in is refused for a minute.
let failures = 0;
let lockedUntil = 0;

/** The Set-Cookie header for a correct password; an error message otherwise. */
export async function signIn(password: string): Promise<{ setCookie: string } | { error: string }> {
  const real = adminPassword();
  if (!real) return { error: "The admin page is off." };
  if (Date.now() < lockedUntil) return { error: "Too many wrong passwords. Wait a minute and try again." };
  if (!timingSafeEqual(sha(password), sha(real))) {
    if (++failures >= 5) { failures = 0; lockedUntil = Date.now() + 60_000; }
    return { error: "Wrong password." };
  }
  failures = 0;
  return { setCookie: await cookie().serialize("admin") };
}

export const signOut = () => cookie().serialize("", { maxAge: 0 });

export type ParticipantSummary = {
  code: string;
  /** The condition on the participant list (with a study plan: the one their first part uses); undefined for a code that only has a log. */
  assigned?: Level;
  /** When the participant withdrew (their data is deleted; the code stays on the list). */
  withdrawn?: string;
  /** Conditions recorded in the log (more than one means the condition changed between sessions). */
  conditions: string[];
  sessions: number;
  /** When consent was first recorded. */
  consentAt?: string;
  first?: string;
  last?: string;
  /** Seconds with activity: gaps of more than five minutes between events are not counted. In a per-part summary only the coding counts, not the quizzes. */
  activeSec: number;
  /** Seconds the participant spent waiting for the system (model calls and program runs), part of activeSec. */
  waitSec: number;
  /** Seconds of model calls alone. */
  modelSec: number;
  events: number;
  requests: number;
  /** Requests the AI answered without changing any code: questions about the code. */
  questionsAsked: number;
  ideasUnaided: number;
  ideasScaffolded: number;
  ideasSkipped: number;
  accepted: number;
  /** Accepted changes whose code the participant looked at first (viewed the diff or went through the walkthrough). */
  acceptedViewed: number;
  rejected: number;
  /** Times the participant edited code on their own initiative (not for a Modify challenge); typing within 30 seconds counts once. */
  selfEdits: number;
  /** The furthest study question reached (in a per-part summary: within that part). */
  questionReached: number;
  /** The same, counting only what happened within the part's suggested time. */
  questionReachedInTime?: number;
  /** Study questions for which some code was accepted, and how many of those within the suggested time. */
  tasksWithCode: number;
  tasksWithCodeInTime?: number;
  /** Seconds from the first question to Finish part (per-part summaries of finished parts). */
  partSec?: number;
  predictRight: number;
  predictTotal: number;
  predictSkipped: number;
  questionsRight: number;
  questionsTotal: number;
  modifyDone: number;
  modifyGiven: number;
  /** The platform's checks on its own teaching items: answer keys that matched the real output, were corrected, or were dropped. */
  itemsVerified: number;
  itemsCorrected: number;
  itemsDropped: number;
  /** Modify challenges whose solution was run: kept because it changes the output, or thrown out because it doesn't. */
  challengesVerified: number;
  challengesDropped: number;
  runs: number;
  errors: number;
  /** Configuration fingerprints recorded when sessions started (more than one: something changed during data collection). */
  configs: string[];
  /** In a per-part summary: which study part (1, 2, ...). */
  part?: number;
  /** The same totals for each study part, when the log has parts. */
  parts?: ParticipantSummary[];
  /** Where the participant is in the study plan, in words. */
  progress?: string;
};

const blank = (code: string): ParticipantSummary => ({
  code, conditions: [], sessions: 0, activeSec: 0, waitSec: 0, modelSec: 0, events: 0, requests: 0, questionsAsked: 0,
  ideasUnaided: 0, ideasScaffolded: 0, ideasSkipped: 0, accepted: 0, acceptedViewed: 0, rejected: 0, selfEdits: 0, questionReached: 0, tasksWithCode: 0,
  predictRight: 0, predictTotal: 0, predictSkipped: 0, questionsRight: 0, questionsTotal: 0, modifyDone: 0, modifyGiven: 0,
  itemsVerified: 0, itemsCorrected: 0, itemsDropped: 0, challengesVerified: 0, challengesDropped: 0, runs: 0, errors: 0, configs: [],
});

type Tally = {
  s: ParticipantSummary; prev: number; activeMs: number; modelMs: number; waitMs: number; solved: Set<string>;
  lastEdit: Map<string, number>;
  /** When each study question was first shown, and when code was first accepted for it. */
  shownAt: Map<number, number>; codeAt: Map<number, number>;
  minutes?: number;
};
const tally = (code: string): Tally => ({ s: blank(code), prev: 0, activeMs: 0, modelMs: 0, waitMs: 0, solved: new Set(), lastEdit: new Map(), shownAt: new Map(), codeAt: new Map() });

/** `timed` = this event counts towards active time (for a study part: only its coding, not its quizzes). */
function count(k: Tally, e: any, timed = true) {
  const { s } = k;
  const d = e.data ?? {};
  s.events++;
  if (e.condition && !s.conditions.includes(e.condition)) s.conditions.push(e.condition);
  const t = Date.parse(e.ts);
  const question = Number(/:q(\d+)$/.exec(String(e.taskId ?? ""))?.[1]) || 0;
  if (!Number.isNaN(t)) {
    s.first ??= e.ts;
    s.last = e.ts;
    if (timed) {
      if (k.prev && t - k.prev < 5 * 60_000) k.activeMs += Math.max(0, t - k.prev);
      k.prev = t;
    }
  }
  if (timed && typeof e.llmMs === "number") k.modelMs += e.llmMs;
  switch (e.type) {
    case "consent": s.consentAt ??= e.ts; break;
    case "vibe_session":
      s.sessions++;
      if (d.configHash && !s.configs.includes(d.configHash)) s.configs.push(d.configHash);
      break;
    case "vibe_wait": if (timed && typeof d.ms === "number") k.waitMs += d.ms; break;
    case "vibe_request": s.requests++; break;
    case "vibe_reply": if (d.blocks === 0) s.questionsAsked++; break;
    case "program_run": s.runs++; break;
    case "vibe_error": s.errors++; break;
    case "vibe_gate":
      if (d.kind === "done") d.scaffolded?.idea || d.scaffolded?.steps ? s.ideasScaffolded++ : s.ideasUnaided++;
      else if (d.kind === "skipped") s.ideasSkipped++;
      break;
    case "vibe_change":
      if (d.status === "accepted") {
        s.accepted++;
        if (d.reviewedBeforeAccept) s.acceptedViewed++;
        if (question && !k.codeAt.has(question)) k.codeAt.set(question, t);
      } else if (d.status === "rejected") s.rejected++;
      break;
    case "study_step":
      if (d.kind === "question_shown") {
        const q = Number(d.question) || 0;
        if (q > s.questionReached) s.questionReached = q;
        if (q && !k.shownAt.has(q)) k.shownAt.set(q, t);
      } else if (d.kind === "part_finished") {
        if (typeof d.seconds === "number") s.partSec = d.seconds;
        if (typeof d.suggestedMinutes === "number") k.minutes = d.suggestedMinutes;
      }
      break;
    case "vibe_quiz_response":
      if (typeof d.chosen === "number") { s.questionsTotal++; if (d.correct) s.questionsRight++; }
      break;
    case "vibe_learn":
      if (d.kind === "predict_answer") { s.predictTotal++; if (d.correct) s.predictRight++; }
      else if (d.kind === "stage" && d.stage === "predict" && d.status === "skipped") s.predictSkipped++;
      else if (d.kind === "challenge_start") s.modifyGiven++;
      else if (d.kind === "challenge_check" && d.done && !k.solved.has(String(d.id))) { k.solved.add(String(d.id)); s.modifyDone++; }
      else if (d.kind === "question_check") d.verdict === "verified" ? s.itemsVerified++ : d.verdict === "corrected" ? s.itemsCorrected++ : s.itemsDropped++;
      else if (d.kind === "challenge_check_solution") { if (d.same) s.challengesDropped++; else if (d.after !== undefined) s.challengesVerified++; }
      else if (d.kind === "student_edit" && !d.duringChallenge) {
        const last = k.lastEdit.get(String(d.path));
        if (last === undefined || t - last > 30_000) s.selfEdits++;
        k.lastEdit.set(String(d.path), t);
      }
      break;
  }
}

function finish(k: Tally, minutes?: number): ParticipantSummary {
  const s: ParticipantSummary = {
    ...k.s, activeSec: Math.round(k.activeMs / 1000), waitSec: Math.round(k.waitMs / 1000), modelSec: Math.round(k.modelMs / 1000), tasksWithCode: k.codeAt.size,
  };
  // What was reached within the suggested time, counted from when the part's first question came up.
  const limit = (k.minutes ?? minutes ?? 0) * 60_000;
  const start = Math.min(...k.shownAt.values());
  if (limit && Number.isFinite(start)) {
    s.questionReachedInTime = Math.max(0, ...[...k.shownAt].filter(([, t]) => t - start <= limit).map(([q]) => q));
    s.tasksWithCodeInTime = [...k.codeAt.values()].filter((t) => t - start <= limit).length;
  }
  return s;
}

/** The whole log's totals, plus the same totals for each study part (events are stamped "part1:q2" and so on). */
function summarise(code: string, text: string): ParticipantSummary {
  const all = tally(code);
  const parts = new Map<number, Tally>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    count(all, e);
    const m = /^part(\d+)(:q\d+)?/.exec(String(e.taskId ?? ""));
    if (m) {
      const n = Number(m[1]);
      if (!parts.has(n)) parts.set(n, tally(code));
      count(parts.get(n)!, e, !!m[2]);
    }
  }
  const plan = readPlan();
  return { ...finish(all), parts: [...parts.entries()].sort((x, y) => x[0] - y[0]).map(([n, k]) => ({ ...finish(k, plan[n - 1]?.minutes), part: n })) };
}

/** Everyone on the participant list, plus anyone who has a log without being on it. */
export async function participantSummaries(): Promise<ParticipantSummary[]> {
  const roster = readRoster();
  const files = await fs.readdir(LOG_DIR).catch(() => [] as string[]);
  const logs = new Map(files.filter((f) => f.endsWith(".jsonl")).map((f) => [f.slice(0, -6).toLowerCase(), f]));
  const out: ParticipantSummary[] = [];
  for (const entry of roster) {
    const file = logs.get(safeName(entry.code).toLowerCase());
    if (file) logs.delete(file.slice(0, -6).toLowerCase());
    const s = file ? summarise(entry.code, await fs.readFile(path.join(LOG_DIR, file), "utf8")) : blank(entry.code);
    out.push({ ...s, assigned: entry.level, withdrawn: entry.withdrawn });
  }
  for (const file of [...logs.values()].sort()) out.push(summarise(file.slice(0, -6), await fs.readFile(path.join(LOG_DIR, file), "utf8")));
  const plan = readPlan();
  if (plan.length) {
    for (const s of out) {
      if (s.withdrawn || !hasProgress(s.code)) continue;
      const p = readProgress(s.code);
      s.progress = p.part >= plan.length ? "Finished"
        : `Part ${p.part + 1}: ${p.step === "work" ? `question ${Math.min(p.task, plan[p.part].tasks.length - 1) + 1} of ${plan[p.part].tasks.length}` : p.step === "pre" ? "quiz before" : "quiz after"}`;
    }
  }
  return out;
}

/** A participant's raw log, or undefined if there is none. */
export async function readLog(code: string): Promise<string | undefined> {
  const want = `${safeName(code)}.jsonl`.toLowerCase();
  const file = (await fs.readdir(LOG_DIR).catch(() => [] as string[])).find((f) => f.toLowerCase() === want);
  return file ? fs.readFile(path.join(LOG_DIR, file), "utf8") : undefined;
}

const MODE: Record<string, string> = { "vibe:guided": "structured", "vibe:off": "regular", "vibe:light": "light" };
const ORDER: Record<string, string> = { guided: "structured-first", off: "regular-first" };
const opt = (n: number | undefined) => n ?? "";

const COLUMNS: [string, (s: ParticipantSummary) => string | number][] = [
  ["participant", (s) => s.code],
  ["order_group", (s) => (s.assigned ? ORDER[s.assigned] ?? s.assigned : "")],
  ["part", (s) => s.part ?? ""],
  ["concept", (s) => (s.part ? readPlan()[s.part - 1]?.concept ?? "" : "")],
  ["mode", (s) => s.conditions.map((c) => MODE[c] ?? c).join(" ")],
  ["sessions", (s) => s.sessions],
  ["first_event", (s) => s.first ?? ""],
  ["last_event", (s) => s.last ?? ""],
  ["part_seconds", (s) => opt(s.partSec)],
  ["active_seconds", (s) => s.activeSec],
  ["ai_wait_seconds", (s) => s.waitSec],
  ["active_seconds_without_ai_wait", (s) => Math.max(0, s.activeSec - s.waitSec)],
  ["model_seconds", (s) => s.modelSec],
  ["question_reached", (s) => s.questionReached || ""],
  ["question_reached_in_time", (s) => opt(s.questionReachedInTime)],
  ["tasks_with_code_accepted", (s) => s.tasksWithCode],
  ["tasks_with_code_accepted_in_time", (s) => opt(s.tasksWithCodeInTime)],
  ["requests", (s) => s.requests],
  ["questions_about_code", (s) => s.questionsAsked],
  ["program_runs", (s) => s.runs],
  ["own_edits", (s) => s.selfEdits],
  ["changes_accepted", (s) => s.accepted],
  ["accepted_after_viewing_code", (s) => s.acceptedViewed],
  ["changes_rejected", (s) => s.rejected],
  ["ideas_unaided", (s) => s.ideasUnaided],
  ["ideas_scaffolded", (s) => s.ideasScaffolded],
  ["ideas_skipped", (s) => s.ideasSkipped],
  ["predictions_right", (s) => s.predictRight],
  ["predictions_total", (s) => s.predictTotal],
  ["predictions_skipped", (s) => s.predictSkipped],
  ["questions_right", (s) => s.questionsRight],
  ["questions_total", (s) => s.questionsTotal],
  ["modify_done", (s) => s.modifyDone],
  ["modify_given", (s) => s.modifyGiven],
  ["quiz_items_verified", (s) => s.itemsVerified],
  ["quiz_items_corrected", (s) => s.itemsCorrected],
  ["quiz_items_dropped", (s) => s.itemsDropped],
  ["modify_tasks_verified", (s) => s.challengesVerified],
  ["modify_tasks_dropped", (s) => s.challengesDropped],
  ["errors", (s) => s.errors],
  ["events", (s) => s.events],
  ["config", (s) => s.configs.join(" ")],
];

const cell = (v: string | number) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = (head: string[], lines: (string | number)[][]) => [head.join(","), ...lines.map((l) => l.map(cell).join(","))].join("\n") + "\n";

export function summariesCsv(rows: ParticipantSummary[]): string {
  // One line per participant, or one line per study part for participants whose log has parts.
  const lines = rows.flatMap((r) => (r.parts?.length ? r.parts.map((p) => ({ ...p, assigned: r.assigned })) : [r]));
  return csv(COLUMNS.map(([h]) => h), lines.map((r) => COLUMNS.map(([, f]) => f(r))));
}

// ---------------------------------------------------------------------------
// Requests for scoring (H3): the first request for each task, with the mode hidden
// ---------------------------------------------------------------------------

export type RequestRow = {
  /** Stands in for who wrote it and in which mode; the key file says which is which. */
  id: string;
  participant: string; order: string; part: number; concept: string; mode: string; question: number; task: string; ts: string; text: string;
  /** In the random fifth that a second person scores, to check agreement. */
  secondScorer: boolean;
};

/**
 * The first request each participant typed for each study question that asked for a program: one the AI
 * answered with code, or (in Structured mode) took to "Explain the idea". Questions about the code, the
 * Explain buttons and requests made to get a Modify challenge done are not requests for a program.
 */
export async function firstRequests(): Promise<RequestRow[]> {
  const plan = readPlan();
  const roster = readRoster();
  const rows: RequestRow[] = [];
  for (const file of (await fs.readdir(LOG_DIR).catch(() => [] as string[])).filter((f) => f.endsWith(".jsonl")).sort()) {
    const taken = new Set<string>();
    const taskText = new Map<string, string>();
    let order = "";
    // The latest typed request, waiting to see whether it led to code.
    let pending: any;
    for (const line of (await fs.readFile(path.join(LOG_DIR, file), "utf8")).split("\n")) {
      if (!line.trim()) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      const d = e.data ?? {};
      if (e.type === "vibe_session" && d.order) order = String(d.order);
      if (e.type === "study_step" && d.kind === "question_shown") taskText.set(e.taskId, String(d.text ?? ""));
      if (e.type === "vibe_request") {
        pending = /^part\d+:q\d+$/.test(String(e.taskId ?? "")) && (!d.source || d.source === "typed") && !d.duringChallenge && !taken.has(e.taskId) ? e : undefined;
        continue;
      }
      if (!pending) continue;
      const ledToCode = (e.type === "vibe_gate" && d.kind === "start") || (e.type === "vibe_reply" && d.blocks > 0);
      if (e.type === "vibe_reply" && !ledToCode) pending = undefined;
      if (!ledToCode) continue;
      const req = pending;
      pending = undefined;
      taken.add(req.taskId);
      const m = /^part(\d+):q(\d+)$/.exec(req.taskId)!;
      const [part, question] = [Number(m[1]), Number(m[2])];
      const participant = String(req.participant ?? file.slice(0, -6));
      const level = roster.find((r) => r.code.toLowerCase() === participant.toLowerCase())?.level;
      rows.push({
        id: createHash("sha256").update(`${participant}|${req.taskId}|${req.ts}`).digest("hex").slice(0, 8),
        participant, order: (level && ORDER[level]) || order, part, concept: plan[part - 1]?.concept ?? "", mode: MODE[req.condition] ?? String(req.condition ?? ""),
        question, task: taskText.get(req.taskId) ?? plan[part - 1]?.tasks[question - 1] ?? "", ts: String(req.ts ?? ""), text: String(req.data?.text ?? ""), secondScorer: false,
      });
    }
  }
  // A fixed pseudo-random fifth for the second scorer, and a row order that says nothing about who or when.
  const mix = (id: string) => createHash("sha256").update(`second:${id}`).digest("hex");
  [...rows].sort((a, b) => mix(a.id).localeCompare(mix(b.id))).slice(0, Math.ceil(rows.length / 5)).forEach((r) => (r.secondScorer = true));
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

/** `blind` leaves out everything that would tell the scorer who wrote a request or in which mode. */
export function requestsCsv(rows: RequestRow[], blind: boolean): string {
  return blind
    ? csv(["id", "concept", "task", "request", "second_scorer", "states_input_0_1", "states_output_0_1", "states_steps_0_1"],
      rows.map((r) => [r.id, r.concept, r.task, r.text, r.secondScorer ? "yes" : "", "", "", ""]))
    : csv(["id", "participant", "order_group", "part", "concept", "mode", "question", "timestamp", "second_scorer"],
      rows.map((r) => [r.id, r.participant, r.order, r.part, r.concept, r.mode, r.question, r.ts, r.secondScorer ? "yes" : ""]));
}

// ---------------------------------------------------------------------------
// Is everything in place for a session?
// ---------------------------------------------------------------------------

export type Check = { label: string; status: "ok" | "warn" | "fail"; detail: string };

function pythonVersion(cmd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      const child = cp.spawn(cmd, ["--version"], { windowsHide: true });
      let out = "";
      const timer = setTimeout(() => { child.kill(); resolve(undefined); }, 4000);
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { out += d; });
      child.on("error", () => { clearTimeout(timer); resolve(undefined); });
      child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 && /Python \d/.test(out) ? out.trim() : undefined); });
    } catch {
      resolve(undefined);
    }
  });
}

/** The fingerprint of the configuration a session would get right now. */
export function currentFingerprint() {
  return studyFingerprint(loadSettings(), readPlan());
}

/** What the proposal needs before a participant sits down, checked against how the server is set up right now. */
export async function readiness(rows: ParticipantSummary[]): Promise<Check[]> {
  const cfg = loadSettings();
  const study = readStudy();
  const checks: Check[] = [];
  const add = (label: string, status: Check["status"], detail: string) => checks.push({ label, status, detail });

  // The tasks
  const plan = study.parts;
  const same = plan.length === EXAMPLE_PLAN.length && plan.every((p, i) => p.concept === EXAMPLE_PLAN[i].concept && p.minutes === EXAMPLE_PLAN[i].minutes && p.tasks.join("\n") === EXAMPLE_PLAN[i].tasks.join("\n"));
  if (!plan.length) add("Study plan", "fail", "No plan is loaded, so a research session is one open conversation with no parts or quizzes. Press “Load the Loops and Lists plan”.");
  else if (same) add("Study plan", "ok", "The Loops and Lists plan: two parts, three tasks each, 12 minutes each.");
  else add("Study plan", "warn", `A plan of your own: ${plan.map((p) => `${p.concept} (${p.tasks.length} task${p.tasks.length === 1 ? "" : "s"}, ${p.minutes || "no"} min)`).join(", ")}. It differs from the Loops and Lists plan in the proposal.`);

  // The quizzes
  if (plan.length) {
    const missing = [
      ...plan.flatMap((p, i) => [!p.preUrl && `${p.concept} quiz before (part ${i + 1})`, !p.postUrl && `${p.concept} quiz after (part ${i + 1})`]),
      !study.endUrl && "closing questionnaire",
    ].filter(Boolean);
    if (missing.length) add("Quiz links", "fail", `Missing: ${missing.join(", ")}. A step without a link is skipped without a word, so that quiz would never be taken.`);
    else add("Quiz links", "ok", `All ${plan.length * 2} quiz links and the closing questionnaire are set.`);
  }

  // The participant list
  const listed = rows.filter((r) => r.assigned && !r.withdrawn);
  const [a, b] = [listed.filter((r) => r.assigned === "guided").length, listed.filter((r) => r.assigned === "off").length];
  const other = listed.length - a - b;
  if (!listed.length) add("Participant list", "fail", "No codes yet. Until the list has codes, any code can sign in and nobody is put in an order group.");
  else if (other) add("Participant list", "warn", `${other} code${other === 1 ? " is" : "s are"} in the Light condition, which the study doesn't use.`);
  else if (Math.abs(a - b) > 1) add("Participant list", "warn", `${a} Structured first and ${b} Regular first: the groups are uneven. Add the next codes with “Random” to even them out.`);
  else add("Participant list", "ok", `${listed.length} code${listed.length === 1 ? "" : "s"}: ${a} Structured first, ${b} Regular first. The proposal plans 30 to 40.`);

  // The model
  const { provider, model } = modelChoice(cfg);
  if (provider === "mock") add("AI model", "fail", "The mock model is on: it gives the same canned replies to everything. Never use it with participants.");
  else if (provider === "eduai") {
    if (cfg.get<string>("eduaiApiKey")) add("AI model", "ok", `EduAI, model ${model}. Press “Test the model” before each day of sessions.`);
    else add("AI model", "fail", "EduAI is selected but has no API key (set EDUAI_API_KEY or eduaiApiKey).");
  } else if (provider === "ollama") add("AI model", "ok", `Ollama at ${cfg.get("ollamaUrl")}, model ${model}: it runs on this server. Press “Test the model” before each day of sessions.`);
  else add("AI model", "warn", `${provider}, model ${model}: what participants type is sent to an outside provider. The proposal says the model runs on a UBC-managed computer and nothing goes to third-party AI providers.`);

  // Running programs: on Judge0 if it's set up, else with this machine's Python
  const target = runTargetFor(cfg);
  if (target.judge0) {
    const r = await runProgram("python", "import sys\nprint(sys.version.split()[0])", "", target);
    const v = r.ok ? r.stdout.trim() : "";
    if (v) add("Running Python", "ok", `Python ${v} on Judge0 at ${target.judge0.url}. Each program runs there as a single file, so it can't import another file of the project.`);
    else add("Running Python", "fail", `Judge0 at ${target.judge0.url} couldn't run a Python program: ${(r.error || r.stderr.trim() || "it printed nothing").replace(/\.+$/, "")}. Participants could not run their programs and nothing could be checked by running it. Check judge0Url (and judge0Token).`);
  } else {
    const py = interpreterFor("python", target.pythonPath);
    const version = await pythonVersion(py);
    if (version) add("Running Python", "ok", `${version} (${py}).`);
    else add("Running Python", "fail", `Could not run “${py}”. Participants could not run their programs and nothing could be checked by running it. Install Python, set pythonPath, or point judge0Url at a Judge0 server.`);
  }

  // The protocol
  const protocol = protocolFor(cfg, true);
  if (protocol.strict) add("Study protocol", "ok", "On: the two modes differ only in explaining the idea (up to 3 rounds), the walkthrough, predict then run, and the “what if” question and change to make. Both write code from the same prompt.");
  else add("Study protocol", "warn", "study.strictProtocol is off, so Structured mode also has clarifying questions, prompt tips and the progress panel, which the proposal doesn't describe.");
  if (!protocol.sameCodePrompt) add("Code-writing prompt", "warn", "study.sameCodePrompt is off, so the two modes write code from different prompts. The proposal says they are the same.");

  // The start screen
  const locked = ["true", "1"].includes(String(cfg.get("lockSettings") ?? ""));
  if (locked) add("Model settings", "ok", "Locked: the start screen has no Model section.");
  else add("Model settings", "warn", "Not locked: on this computer the start screen shows a Model section that changes the model. Set \"lockSettings\": true in vibelearner.config.json, and open /study for participants.");

  if (embeddedDemo()) add("Embedded demo mode", "fail", "VL_EMBEDDED is on, which relaxes the sign-in cookies so the app can be shown inside another site's page. Start the server without it for a study.");

  // The consent form
  const consent = readConsent();
  if (consent.custom) add("Consent form", "ok", `Your own wording (version ${consent.version}).`);
  else add("Consent form", "warn", `The built-in summary of the proposal (version ${consent.version}). Replace it below with the wording the ethics board approved.`);

  // Frozen configuration
  if (plan.length) {
    const now = studyFingerprint(cfg, plan).hash;
    const frozen = readFreeze();
    const used = new Map<string, number>();
    for (const r of rows) for (const p of r.parts ?? []) for (const c of p.configs) used.set(c, (used.get(c) ?? 0) + 1);
    const others = [...used.keys()].filter((c) => c !== (frozen?.hash ?? now));
    if (!frozen) add("Configuration", "warn", `Not frozen yet (now ${now}). After the pilot sessions, press “Freeze this configuration”: any later change to the model, prompts, settings or tasks will show up here.`);
    else if (frozen.hash !== now) add("Configuration", "fail", `It has changed since it was frozen on ${frozen.at.slice(0, 10)} (frozen ${frozen.hash}, now ${now}). Put the model, settings and tasks back, or freeze again if the change is meant.`);
    else if (others.length) add("Configuration", "warn", `Frozen (${now}), but ${others.length} other configuration${others.length === 1 ? " is" : "s are"} in the logs: ${others.join(", ")}. The “config” column of the summary says which sessions.`);
    else add("Configuration", "ok", `Frozen on ${frozen.at.slice(0, 10)} (${now})${used.size ? " and every logged session used it" : ""}.`);
  }
  return checks;
}

/** One real request to the model, to see that it answers before a participant is waiting on it. */
export async function testModel(): Promise<{ ok: boolean; message: string }> {
  const cfg = loadSettings();
  const { provider, model } = modelChoice(cfg);
  try {
    const res = await callBackend({ model, system: "You are part of a connection test.", prompt: "Reply with the single word: ready", temperature: 0, settings: cfg });
    const text = res.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return text
      ? { ok: true, message: `${provider} · ${model} answered in ${(res.ms / 1000).toFixed(1)} s: “${text.slice(0, 60)}”` }
      : { ok: false, message: `${provider} · ${model} answered with nothing after ${(res.ms / 1000).toFixed(1)} s.` };
  } catch (err: any) {
    return { ok: false, message: `${provider} · ${model} failed: ${String(err?.message || err).slice(0, 300)}` };
  }
}
