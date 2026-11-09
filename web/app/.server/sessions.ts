import type { Command, Snapshot } from "~/lib/types";
import { conditionFor, finishPart, markPartStarted, PARTS, type Participant } from "./participants";
import { VibeSession } from "./session";

/**
 * One VibeSession per participant and part, found by the sign-in cookie (so a reload, or a second tab, carries on
 * where they were). Sessions live in server memory: a restart ends them, but files and research logs are on disk.
 * The browser gets every change over Server-Sent Events.
 */
type Entry = { session: VibeSession; listeners: Set<(s: Snapshot) => void>; ready: Promise<void> };
const g = globalThis as unknown as { __vibeSessions?: Map<string, Entry> };
// Kept on globalThis so dev-server reloads don't drop running sessions.
const sessions = (g.__vibeSessions ??= new Map<string, Entry>());

const keyOf = (p: Participant) => `${p.code}#${p.part}`;

/** The participant's session for the part they're on, started (and the part marked as started) the first time. */
export async function sessionFor(p: Participant): Promise<{ key: string; session: VibeSession }> {
  const key = keyOf(p);
  let e = sessions.get(key);
  if (!e) {
    const level = conditionFor(p);
    if (!level) throw new Error(`${p.code} has finished both parts.`);
    const listeners = new Set<(s: Snapshot) => void>();
    const session = new VibeSession(key, (s) => listeners.forEach((l) => l(s)));
    const ready = session.begin({ participant: p.code, level, part: p.part, parts: PARTS });
    e = { session, listeners, ready };
    sessions.set(key, e);
    markPartStarted(p.code, p.part);
    ready.catch(() => sessions.delete(key));
  }
  await e.ready;
  return { key, session: e.session };
}

export function subscribe(key: string, listener: (s: Snapshot) => void): () => void {
  const e = sessions.get(key);
  if (!e) return () => {};
  e.listeners.add(listener);
  return () => e.listeners.delete(listener);
}

/** "Finish part N": the session's last log line, then the participant moves on and this session is let go. */
export async function finishCurrentPart(p: Participant) {
  const key = keyOf(p);
  const e = sessions.get(key);
  if (e) await e.session.endPart();
  finishPart(p.code, p.part);
  sessions.delete(key);
}

/** Runs a browser command. Model calls can take minutes, so this isn't awaited by the request; results arrive as events. */
export function dispatch(session: VibeSession, cmd: Command) {
  const run = async () => {
    switch (cmd.type) {
      case "send": return session.send(String(cmd.text ?? ""), cmd.target ? String(cmd.target) : undefined);
      case "action": return session.action(String(cmd.cmd ?? ""), cmd.arg === undefined ? undefined : String(cmd.arg));
      case "quizAnswer": return session.answerQuiz(Number(cmd.choice));
      case "open": await session.open(String(cmd.path)); return session.refresh();
      case "save": return session.save(String(cmd.path), String(cmd.content ?? ""));
      case "select": return session.select(String(cmd.path), Number(cmd.start) || undefined, Number(cmd.end) || undefined);
      case "closeDiff": return session.closeDiff();
    }
  };
  run().catch((err) => session.reportError(err));
}
