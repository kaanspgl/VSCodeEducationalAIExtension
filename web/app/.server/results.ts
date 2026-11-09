import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.ts";
import { logFile, safeName } from "./logger.ts";
import { CONDITION_LABEL, PARTS, type Participant } from "./participants.ts";

/**
 * What the admin pages show: each participant's research log, summed up per part, and as a readable timeline.
 * Everything is worked out from data/study_logs/<code>.jsonl, so it matches what an analysis of the logs finds.
 *
 * Uses only Node built-ins and erasable TypeScript, so the tests can import it directly.
 */

export type LogEvent = {
  ts: string;
  participant: string;
  condition?: string;
  part?: number;
  type: string;
  llmMs?: number;
  data?: Record<string, any>;
};

export function readLog(code: string): LogEvent[] {
  let raw = "";
  try {
    raw = fs.readFileSync(logFile(code), "utf8");
  } catch {
    return [];
  }
  const out: LogEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a line cut short by a crash */
    }
  }
  return out;
}

export type PartSummary = {
  part: number;
  condition: string;
  status: "not started" | "in progress" | "finished";
  startedAt?: string;
  finishedAt?: string;
  /** From the start of the part to "Finish", or to its last event while it's still going. */
  minutes?: number;
  requests: number;
  accepted: number;
  rejected: number;
  predictRight: number;
  predictTotal: number;
  quizRight: number;
  quizTotal: number;
  challengesDone: number;
  challengesGiven: number;
  runs: number;
  /** Structured only: "explain the idea" steps started, and skipped. */
  ideaSteps: number;
  ideaSkipped: number;
  /** Time the model took on the replies that log it (the ones that write code). */
  aiSeconds: number;
  events: number;
};

/** Events that belong to a part. Lines from before parts existed count as part 1. */
export const inPart = (e: LogEvent, part: number) => (e.part ?? 1) === part;

export function summarize(p: Participant, events: LogEvent[]): PartSummary[] {
  const out: PartSummary[] = [];
  for (let part = 1; part <= PARTS; part++) {
    const ev = events.filter((e) => inPart(e, part) && e.type !== "consent" && e.type !== "sign_in");
    const rec = p.parts[part - 1] ?? {};
    const kind = (e: LogEvent) => e.data?.kind;
    const doneIds = new Set(ev.filter((e) => kind(e) === "challenge_check" && e.data?.done).map((e) => e.data?.id));
    const startedAt = rec.startedAt ?? ev[0]?.ts;
    const end = rec.finishedAt ?? ev[ev.length - 1]?.ts;
    const status = rec.finishedAt || p.part > part ? "finished" : startedAt ? "in progress" : "not started";
    out.push({
      part,
      condition: CONDITION_LABEL[p.order[part - 1]] ?? p.order[part - 1],
      status,
      startedAt,
      finishedAt: rec.finishedAt,
      minutes: startedAt && end ? Math.max(0, Math.round((Date.parse(end) - Date.parse(startedAt)) / 6000) / 10) : undefined,
      requests: ev.filter((e) => e.type === "vibe_request").length,
      accepted: ev.filter((e) => e.type === "vibe_change" && e.data?.status === "accepted").length,
      rejected: ev.filter((e) => e.type === "vibe_change" && e.data?.status === "rejected").length,
      predictRight: ev.filter((e) => kind(e) === "predict_answer" && e.data?.correct === true).length,
      predictTotal: ev.filter((e) => kind(e) === "predict_answer").length,
      quizRight: ev.filter((e) => e.type === "vibe_quiz_response" && e.data?.correct === true).length,
      quizTotal: ev.filter((e) => e.type === "vibe_quiz_response" && typeof e.data?.correct === "boolean").length,
      challengesDone: doneIds.size,
      challengesGiven: ev.filter((e) => kind(e) === "challenge_start").length,
      runs: ev.filter((e) => e.type === "program_run").length,
      ideaSteps: ev.filter((e) => e.type === "vibe_gate" && kind(e) === "start").length,
      ideaSkipped: ev.filter((e) => e.type === "vibe_gate" && kind(e) === "skipped").length,
      aiSeconds: Math.round(ev.reduce((s, e) => s + (e.llmMs ?? 0), 0) / 1000),
      events: ev.length,
    });
  }
  return out;
}

export const statusOf = (p: Participant) => (p.part > PARTS ? "Finished" : `Part ${p.part}`);

const CSV_COLUMNS = [
  "code", "order", "consented_at", "status", "part", "condition", "part_status", "started_at", "finished_at", "minutes",
  "requests", "changes_accepted", "changes_rejected", "predict_right", "predict_total", "quiz_right", "quiz_total",
  "challenges_done", "challenges_given", "program_runs", "idea_steps", "idea_steps_skipped", "ai_reply_seconds", "events",
] as const;

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per participant and part (long format, ready for R or pandas). */
export function summaryCsv(list: Participant[]): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const p of list) {
    for (const s of summarize(p, readLog(p.code))) {
      rows.push([
        p.code, p.order.map((c) => CONDITION_LABEL[c]).join(" then "), p.consent?.at, statusOf(p), s.part, s.condition, s.status,
        s.startedAt, s.finishedAt, s.minutes, s.requests, s.accepted, s.rejected, s.predictRight, s.predictTotal, s.quizRight,
        s.quizTotal, s.challengesDone, s.challengesGiven, s.runs, s.ideaSteps, s.ideaSkipped, s.aiSeconds, s.events,
      ].map(cell).join(","));
    }
  }
  return rows.join("\n") + "\n";
}

/** Participants without their PIN hashes, for the downloads. */
export function participantsCsv(list: Participant[]): string {
  const rows = ["code,order,consented_at,consent_version,status,part1_started,part1_finished,part2_started,part2_finished,created_at"];
  for (const p of list) {
    rows.push([
      p.code, p.order.map((c) => CONDITION_LABEL[c]).join(" then "), p.consent?.at, p.consent?.version, statusOf(p),
      p.parts[0]?.startedAt, p.parts[0]?.finishedAt, p.parts[1]?.startedAt, p.parts[1]?.finishedAt, p.createdAt,
    ].map(cell).join(","));
  }
  return rows.join("\n") + "\n";
}

const clip = (s: unknown, n = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** One line for the timeline. The full event is shown under it. */
export function describe(e: LogEvent): string {
  const d = e.data ?? {};
  switch (e.type) {
    case "consent": return `Consented (${d.version ?? "?"})`;
    case "sign_in": return "Signed in";
    case "vibe_session": return `Part ${d.part ?? e.part ?? 1} started: ${d.condition ?? d.level} (model ${d.model})`;
    case "part_finished": return `Finished part ${d.part ?? e.part}`;
    case "vibe_request": return `Asked: ${clip(d.text)}`;
    case "vibe_reply": return `AI replied${d.changes?.length ? ` with ${d.changes.length} change${d.changes.length === 1 ? "" : "s"}` : ""}: ${clip(d.text)}`;
    case "vibe_change":
      if (d.status === "accepted") return `Accepted a change to ${d.path} (+${d.added ?? 0} −${d.removed ?? 0})${d.reviewedBeforeAccept ? ", after reviewing it" : ""}`;
      if (d.status === "rejected") return `Rejected a change to ${d.path}`;
      if (d.status === "viewed_diff") return `Looked at the diff for ${d.path}`;
      return `Change ${d.status}${d.path ? `: ${d.path}` : ""}`;
    case "vibe_gate":
      if (d.kind === "start") return `Explain-the-idea step started for: ${clip(d.request)}`;
      if (d.kind === "idea_answer") return `Explained the idea: ${clip(d.text)}`;
      if (d.kind === "idea_check") return `AI checked the idea: ${d.verdict ?? "?"}`;
      if (d.kind === "steps_answer") return `Wrote the steps: ${clip(d.text)}`;
      if (d.kind === "steps_check") return `AI checked the steps: ${d.verdict ?? "?"}`;
      if (d.kind === "done") return "Idea step done";
      if (d.kind === "skipped") return "Skipped the idea step";
      return `Idea step: ${d.kind}`;
    case "vibe_learn":
      if (d.kind === "predict_answer") return `Predicted "${clip(d.prediction, 60)}"; it printed "${clip(d.actual, 60)}": ${d.correct ? "right" : "wrong"}`;
      if (d.kind === "predict_start") return "Asked to predict the output";
      if (d.kind === "tour_start") return `Walkthrough started (${d.stops} stops)`;
      if (d.kind === "tour_end") return `Walkthrough ended at stop ${d.reachedStop} of ${d.of} (${d.status})`;
      if (d.kind === "question_check") return `Question checked by running the changed program: ${d.verdict}`;
      if (d.kind === "question_unverified") return `Question couldn't be checked by running it (${d.reason})`;
      if (d.kind === "challenge_start") return `Modify challenge: ${clip(d.task)}`;
      if (d.kind === "challenge_check") return `Checked their Modify work: ${d.done ? "done" : "not yet"} (decided by ${d.decidedBy})`;
      if (d.kind === "challenge_hint") return "Asked for a hint";
      if (d.kind === "challenge_skip") return "Skipped the Modify challenge";
      if (d.kind === "student_edit") return `Edited ${d.path} themselves`;
      if (d.kind === "stage") return `${d.stage}: ${d.status}`;
      if (d.kind === "set_target") return `Code goes in: ${d.target}`;
      return `Learning: ${d.kind}`;
    case "vibe_route": return `AI sorted the request: ${[d.intent, d.size, d.logic === true ? "needs logic" : d.logic === false ? "no real logic" : undefined].filter(Boolean).join(", ") || "?"}`;
    case "vibe_quiz_question": return `Question: ${clip(d.stem)}`;
    case "vibe_quiz_response": return d.skippedAt !== undefined ? "Skipped the question" : `Answered ${"ABCD"[d.chosen] ?? "?"}: ${d.correct ? "right" : "wrong"}`;
    case "program_run": return `Ran ${d.file}${d.error ? `: ${d.error}` : d.timedOut ? ": timed out" : d.stderr ? ": crashed" : ""}`;
    case "vibe_plan": return d.newProject ? `Started a new project: ${d.newProject}` : "Plan";
    case "vibe_error": return `Error: ${clip(d.message)}`;
    case "parse_failure": return "The AI's reply couldn't be read";
    default: return e.type;
  }
}

/** The folder holding a participant's files for one part. */
export const partFolder = (code: string, part: number) => path.join(DATA_DIR, "workspaces", `p-${safeName(code)}`, `part-${part}`);
