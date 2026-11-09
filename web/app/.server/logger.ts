import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config.ts";

/**
 * Append-only JSONL research log, one file per participant (data/study_logs/<code>.jsonl), in the same
 * format as the VS Code extension's log, plus the study part (1 or 2) on every line. Nothing is written for a
 * code until its participant has consented.
 */
export class StudyLogger {
  private enabled = false;
  private participant = "";
  private condition = "";
  private part: number | undefined;
  private file: string | undefined;
  private queue: Promise<void> = Promise.resolve();

  enable(participant: string, condition: string, part?: number) {
    this.participant = participant;
    this.condition = condition;
    this.part = part;
    this.file = logFile(participant);
    this.enabled = true;
  }

  get filePath(): string | undefined {
    return this.file;
  }

  log(type: string, taskId?: string, data?: Record<string, unknown>, llmMs?: number) {
    if (!this.enabled || !this.file) return;
    const file = this.file;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      participant: this.participant,
      condition: this.condition,
      part: this.part,
      taskId,
      type,
      llmMs,
      data,
    }) + "\n";
    // Serialise writes so concurrent events never interleave.
    this.queue = this.queue.then(() => append(file, line));
  }

  async flush() {
    await this.queue;
  }
}

/** One event outside a coding session (consent, sign-in). */
export function logEvent(participant: string, type: string, data?: Record<string, unknown>, part?: number): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), participant, part, type, data }) + "\n";
  return append(logFile(participant), line);
}

export const logFile = (participant: string) => path.join(DATA_DIR, "study_logs", `${safeName(participant)}.jsonl`);

async function append(file: string, line: string) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, line, "utf8");
  } catch (err) {
    console.error("[VibeLearner] failed to write study log", err);
  }
}

export function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "unknown";
}
