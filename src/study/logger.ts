import * as vscode from 'vscode';

export type StudyEventType =
  | 'session_start'
  | 'task_start'
  | 'student_explanation'
  | 'clarification_prompt'
  | 'clarification_response'
  | 'reasoning_status'
  | 'fallback_used'
  | 'code_generated'
  | 'code_edited'
  | 'tests_run'
  | 'program_run'
  | 'vibe_session'
  | 'vibe_request'
  | 'vibe_route'
  | 'vibe_reply'
  | 'vibe_change'
  | 'vibe_quiz_question'
  | 'vibe_quiz_response'
  | 'vibe_error'
  | 'vibe_plan'
  | 'vibe_learn'
  | 'quiz_question'
  | 'quiz_response'
  | 'review_question'
  | 'change_request'
  | 'change_check_prompt'
  | 'change_check_response'
  | 'comprehension_question'
  | 'comprehension_response'
  | 'comprehension_feedback'
  | 'direct_request'
  | 'direct_response'
  | 'survey'
  | 'task_end'
  | 'model_error'
  | 'parse_failure';

export type StudyEvent = {
  ts: string;
  participant: string;
  condition: string;
  taskId?: string;
  type: StudyEventType;
  /** Model wait time for this event, kept separate from student interaction time. */
  llmMs?: number;
  data?: Record<string, unknown>;
};

/**
 * Append-only JSONL log, one file per participant. Nothing is written until the participant
 * has consented (`enable()` is only called after the consent step in the UI).
 */
export class StudyLogger {
  private enabled = false;
  private participant = '';
  private condition = '';
  private fileUri: vscode.Uri | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly storageUri: vscode.Uri) {}

  enable(participant: string, condition: string) {
    this.participant = participant;
    this.condition = condition;
    this.fileUri = vscode.Uri.joinPath(this.storageUri, 'study_logs', `${safeName(participant)}.jsonl`);
    this.enabled = true;
  }

  get filePath(): string | undefined {
    return this.fileUri?.fsPath;
  }

  log(type: StudyEventType, taskId?: string, data?: Record<string, unknown>, llmMs?: number) {
    if (!this.enabled || !this.fileUri) return;
    const event: StudyEvent = {
      ts: new Date().toISOString(),
      participant: this.participant,
      condition: this.condition,
      taskId,
      type,
      llmMs,
      data,
    };
    const uri = this.fileUri;
    const line = new TextEncoder().encode(JSON.stringify(event) + '\n');
    // Serialise writes so concurrent events never clobber each other.
    this.queue = this.queue.then(async () => {
      try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.storageUri, 'study_logs'));
        const existing = await vscode.workspace.fs.readFile(uri).then(d => d, () => new Uint8Array());
        const combined = new Uint8Array(existing.length + line.length);
        combined.set(existing);
        combined.set(line, existing.length);
        await vscode.workspace.fs.writeFile(uri, combined);
      } catch (err) {
        console.error('[VibeLearner] failed to write study log', err);
      }
    });
  }

  async flush() {
    await this.queue;
  }
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'unknown';
}
