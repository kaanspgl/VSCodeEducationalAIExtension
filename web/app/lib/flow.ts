import { useEffect, useState } from "react";
import type { MsgButton, StageStatus, VibeChange, VibeMsg, VibeView } from "./types";

/**
 * What the page shows about where the student is: the Structured steps with their parts, and the one thing to do
 * now. Worked out from the view the server sends, so it never disagrees with the conversation.
 */

export const DEFAULT_LABELS = ["Explain the idea", "Walk through the code", "Predict, run & modify"];

export type Status = "todo" | "now" | "done" | "skipped" | "na";
export type SubStep = { key: string; label: string; status: Status; detail?: string };
export type FlowStep = { n: number; label: string; status: "todo" | "now" | "done"; desc?: string; subs: SubStep[] };

/** The change card with this id, newest first (a card is updated in place as it is accepted or rejected). */
export function findChange(view: VibeView, id?: string): VibeChange | undefined {
  if (!id) return undefined;
  for (let i = view.messages.length - 1; i >= 0; i--) {
    const c = view.messages[i].changes?.find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

export function pendingChanges(view: VibeView): VibeChange[] {
  return view.messages.flatMap((m) => m.changes ?? []).filter((c) => c.status === "pending");
}

const SUB_LABEL = {
  tour: "Read the code with the AI, part by part",
  accept: "Accept the code",
  predict: "Predict what it prints, then run it",
  check: "Answer a question about it",
  challenge: "Change it yourself",
} as const;

const asStatus = (s?: StageStatus): Status =>
  s === "active" ? "now" : s === "done" ? "done" : s === "skipped" ? "skipped" : s === "na" ? "na" : "todo";

/** The three Structured steps, each with its parts and how far along they are. Before a request they are all to do. */
export function flowSteps(view: VibeView): FlowStep[] {
  const st = view.structured;
  const labels = st?.labels ?? DEFAULT_LABELS;
  const card = findChange(view, st?.changeId);
  const learn = (stage: string) => card?.learn?.find((s) => s.stage === stage)?.status;

  const tour: SubStep = {
    key: "tour", label: SUB_LABEL.tour, status: asStatus(learn("tour")),
    detail: view.tour ? `part ${view.tour.index + 1} of ${view.tour.total}` : undefined,
  };
  const accept: SubStep = {
    key: "accept", label: SUB_LABEL.accept,
    status: card?.status === "accepted" ? "done" : card?.status === "pending" && learn("tour") !== "active" && st?.sub === "accept the code" ? "now" : "todo",
  };
  const later: SubStep[] = (["predict", "check", "challenge"] as const).map((k) => ({ key: k, label: SUB_LABEL[k], status: asStatus(learn(k)) }));
  // The usual flow walks through the code in Step 2; with "write the steps" first, everything after is Step 3.
  const walkInTwo = labels[1] !== "Write the steps";

  const cur = st?.step ?? 0;
  return labels.map((label, i) => {
    const n = i + 1;
    const status = st?.done || n < cur ? "done" : n === cur ? "now" : "todo";
    const subs = n === 1 ? [] : walkInTwo ? (n === 2 ? [tour, accept] : later) : n === 3 ? [tour, accept, ...later] : [];
    const desc = n === 1 ? "In your own words, before any code is written." : n === 2 && !walkInTwo ? "Every step, in your own words." : undefined;
    return { n, label, status, desc, subs };
  });
}

export type Now = {
  title: string;
  text?: string;
  /** Markdown to show above the text (a Modify challenge's task). */
  markdown?: string;
  /** Where to look: the chat box, the box under the code, or the bar above it (Accept / Reject). */
  where?: "chat" | "code" | "above";
  busy?: boolean;
  done?: boolean;
  actions?: MsgButton[];
};

/** The Modify challenge still waiting on the student (its message carries the Hint / Check my work / Skip buttons). */
export function openChallenge(view: VibeView): VibeMsg | undefined {
  const task = view.study?.step === "work" ? view.study.task : undefined;
  for (let i = view.messages.length - 1; i >= 0; i--) {
    const m = view.messages[i];
    if (m.look === "challenge" && m.buttons?.length) return task === undefined || m.task === undefined || m.task === task ? m : undefined;
  }
  return undefined;
}

/**
 * The one thing to do now, in Structured mode only: Regular vibe coding gets no extra guidance, so the two
 * conditions still differ only in the steps the study describes.
 */
export function nowCard(view: VibeView): Now | undefined {
  if (view.level !== "guided" || view.stage !== "chat") return undefined;
  if (view.busy) return { title: view.busyLabel || "Working on it…", text: "This takes a few seconds.", busy: true };
  if (view.quiz) return { title: "Answer the question", text: "It's in the box under the code. Pick the answer you think is right.", where: "code" };
  if (view.tour) {
    return {
      title: "Read the highlighted code",
      text: "The explanation is in the box under the code. Press Next when you're ready. If something isn't clear, ask in the chat.",
      where: "code",
    };
  }
  if (view.awaiting === "gate") return { title: "Explain your idea", text: "Reply in the chat, in your own words: how will the program work?", where: "chat" };
  if (view.awaiting === "predict") {
    return { title: "Predict what it prints", text: "Read the code, then type your guess in the chat. After that it runs, so you can compare.", where: "chat" };
  }
  const st = view.structured;
  const card = findChange(view, st?.changeId);
  if (st && !st.done && card?.status === "pending" && st.sub === "accept the code") {
    // The buttons stay on the bar above the code, so the code is what the student looks at while deciding.
    return {
      title: "Accept or reject the code",
      text: "If it does what you asked for, accept it. If not, reject it and ask for something else.",
      where: "above",
    };
  }
  const ch = openChallenge(view);
  if (ch) {
    const task = ch.text.split(/\n\s*\n/)[0];
    return {
      title: "Change the program yourself",
      markdown: task,
      text: "Edit the code in the editor, or ask the AI in the chat to make the change. Then press Check my work.",
      actions: ch.buttons,
    };
  }
  const sv = view.study?.step === "work" ? view.study : undefined;
  if (st?.done) {
    const last = !sv || sv.task >= sv.tasks.length - 1;
    return {
      title: "All three steps done",
      done: true,
      text: !sv ? "Ask for the next thing whenever you're ready."
        : !last ? "Go on to the next question when you're ready. You can keep asking about your program first."
        : "That was the last question. Keep working with your programs until the part is over.",
      actions: sv && !last ? [{ label: "Next question ▶", cmd: "studyNext", primary: true }] : undefined,
    };
  }
  if (st) return { title: "Keep going", text: "Follow the AI in the chat." };
  return sv
    ? { title: "Ask for the program", text: "Use the chat to ask the AI for this question's program.", where: "chat" }
    : { title: "Ask for something to build", text: "Describe what you want in the chat.", where: "chat" };
}

/** Seconds since `started` (ms since 1970), ticking; undefined until the browser has the time. */
export function useElapsed(started: number | undefined): number | undefined {
  const [now, setNow] = useState<number | undefined>(undefined);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now === undefined || started === undefined ? undefined : Math.max(0, Math.floor((now - started) / 1000));
}

export const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
