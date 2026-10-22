/** View state the server session sends to the browser (same shape as the extension's webview state). */

export type Level = "off" | "light" | "guided";
export type Stage = "tour" | "predict" | "check" | "challenge";
export type StageStatus = "todo" | "active" | "done" | "skipped" | "na";

export type VibeChange = {
  id: string;
  path: string;
  isNew: boolean;
  added: number;
  removed: number;
  status: "pending" | "accepted" | "rejected" | "failed";
  note?: string;
  learn?: { stage: Stage; label: string; status: StageStatus }[];
};

export type MsgButton = { label: string; cmd: string; arg?: string; primary?: boolean };

export type VibeMsg = {
  id: number;
  role: "student" | "tutor" | "system";
  text: string;
  changes?: VibeChange[];
  buttons?: MsgButton[];
  tip?: { text: string; improved?: string; score: number };
};

export type VibeView = {
  kind: "vibe";
  stage: "setup" | "chat";
  level: Level;
  logging: boolean;
  participant: string;
  /** Shown on the Start screen when a participant code or consent is missing. */
  setupError?: string;
  messages: VibeMsg[];
  busy: boolean;
  busyLabel: string;
  inputEnabled: boolean;
  placeholder: string;
  draft?: string;
  quiz?: { label: string; index: number; total: number; stem: string; choices: string[] };
  /** Structured vibe coding progress for the current request: the step names, the current step, and what is happening in it. */
  structured?: { labels: string[]; step: number; sub?: string };
  tour?: { index: number; total: number; title: string; text: string; path: string; start: number; end: number; pending: boolean };
  plan?: { goal: string; steps: { title: string; status: string }[]; next?: { index: number; title: string }; remaining: number };
  concepts: { name: string; seen: number; right: number; total: number }[];
  skills: { label: string; value: string; detail: string }[];
  ctx: { files: number; active: string; selection: string };
  /** Folder of the current "new project", if any. */
  project?: string;
  /** Where code goes: 'auto', 'new', or a project-relative file path. */
  target: string;
  targets: string[];
  levelLocked: boolean;
};

/** What the code editor shows. The server decides (walkthroughs, diffs, accepted files); the student can open and edit files. */
export type EditorView = {
  files: string[];
  mode: "none" | "file" | "proposed" | "diff";
  path?: string;
  /** File or proposed content; replaced in the editor only when `version` changes, so typing is never overwritten. */
  content?: string;
  version: number;
  readOnly: boolean;
  highlight?: { start: number; end: number };
  diff?: { title: string; original: string; modified: string };
};

export type Snapshot = { view: VibeView; editor: EditorView };

/** Messages from the browser to the session (POST /api/command). */
export type Command =
  | { type: "begin"; participant?: string; consent?: boolean; level?: string }
  | { type: "send"; text: string; target?: string }
  | { type: "action"; cmd: string; arg?: string }
  | { type: "quizAnswer"; choice: number }
  | { type: "open"; path: string }
  | { type: "save"; path: string; content: string }
  | { type: "select"; path: string; start?: number; end?: number }
  | { type: "closeDiff" };
