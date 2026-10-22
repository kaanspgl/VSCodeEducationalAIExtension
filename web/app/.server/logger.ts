import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config";

/**
 * Append-only JSONL research log, one file per participant (data/study_logs/<code>.jsonl), in the same
 * format as the VS Code extension's log. Nothing is written until the participant has consented.
 */
export class StudyLogger {
  private enabled = false;
  private participant = "";
  private condition = "";
  private file: string | undefined;
  private queue: Promise<void> = Promise.resolve();

  enable(participant: string, condition: string) {
    this.participant = participant;
    this.condition = condition;
    this.file = path.join(DATA_DIR, "study_logs", `${safeName(participant)}.jsonl`);
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
      taskId,
      type,
      llmMs,
      data,
    }) + "\n";
    // Serialise writes so concurrent events never interleave.
    this.queue = this.queue.then(async () => {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.appendFile(file, line, "utf8");
      } catch (err) {
        console.error("[VibeLearner] failed to write study log", err);
      }
    });
  }

  async flush() {
    await this.queue;
  }
}

export function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "unknown";
}
