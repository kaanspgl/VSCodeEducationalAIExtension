import { useEffect, useState } from "react";
import type { StageStatus, VibeChange, VibeMsg, VibeView } from "./types";

/**
 * What the page shows about where the student is: the Structured steps with their parts, the heading of the card
 * for what happens now, and the current exchange with the AI. Worked out from the view the server sends, so it
 * never disagrees with the conversation.
 */

export const DEFAULT_LABELS = ["Explain the idea", "Walk through the code", "Predict, run & modify"];

export type Status = "todo" | "now" | "done" | "skipped" | "na";
export type SubStep = { key: string; label: string; status: Status; detail?: string };
export type FlowStep = { n: number; label: string; status: "todo" | "now" | "done"; subs: SubStep[] };

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

const SUB_LABEL = { tour: "Read it with the AI", accept: "Accept it", predict: "Predict the output", check: "Answer a question", challenge: "Change it yourself" } as const;

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
    detail: view.tour ? `${view.tour.index + 1} of ${view.tour.total}` : undefined,
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
    return { n, label, status, subs };
  });
}

/** The heading of the card: what is happening now. The AI's own message under it says the rest. */
export type Now = { title: string; text?: string; busy?: boolean; done?: boolean };

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
 * The heading for what happens now, in Structured mode only: Regular vibe coding gets no extra guidance, so the
 * two conditions still differ only in the steps the study describes. It names the step; it doesn't repeat what
 * the AI's message under it already says.
 */
export function nowCard(view: VibeView): Now | undefined {
  if (view.level !== "guided" || view.stage !== "chat") return undefined;
  if (view.busy) return { title: view.busyLabel || "Working on it…", busy: true };
  if (view.quiz) return { title: "Answer the question" };
  if (view.tour) return { title: "Read the highlighted code", text: "Press Next when you're ready. If something isn't clear, ask below." };
  if (view.awaiting === "gate") return { title: "Explain your idea" };
  if (view.awaiting === "predict") return { title: "Predict what it prints" };
  const st = view.structured;
  const card = findChange(view, st?.changeId);
  if (st && !st.done && card?.status === "pending" && st.sub === "accept the code") {
    return { title: "Keep this code?", text: "If it does what you asked for, accept it. If not, reject it and ask for something else." };
  }
  if (openChallenge(view)) return { title: "Change the program yourself" };
  if (st?.done) return { title: "All three steps done", done: true };
  if (st) return { title: "Keep going" };
  return { title: view.study?.step === "work" ? "Ask for the program" : "Ask for something to build" };
}

/**
 * The exchange on screen: the student's last message on this question and everything said since (the output of
 * ▶ Run is under the code, so it is left out). Earlier exchanges are in the history. Once Step 3 has begun, the
 * code is accepted and the messages from explaining and walking through it are over: they fold into `earlier`.
 */
export function currentExchange(view: VibeView): { you?: VibeMsg; replies: VibeMsg[]; earlier: VibeMsg[] } {
  const task = view.study?.step === "work" ? view.study.task : undefined;
  const msgs = task === undefined ? view.messages : view.messages.filter((m) => m.task === undefined || m.task === task);
  let i = msgs.length - 1;
  while (i >= 0 && msgs[i].role !== "student") i--;
  let you: VibeMsg | undefined = i >= 0 ? msgs[i] : undefined;
  let replies = msgs.slice(i + 1).filter((m) => m.look !== "output");
  const latest = [...replies].reverse().find((m) => m.step !== undefined)?.step;
  const over = (m: VibeMsg) => latest !== undefined && latest >= 3 && m.step !== undefined && m.step < latest;
  const earlier = [...(you && over(you) ? [you] : []), ...replies.filter(over)];
  if (you && over(you)) you = undefined;
  replies = replies.filter((m) => !over(m));
  return { you, replies, earlier };
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
