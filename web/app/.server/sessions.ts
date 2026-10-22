import { randomUUID } from "node:crypto";
import { createCookie } from "react-router";
import type { Command, Snapshot } from "~/lib/types";
import { VibeSession } from "./session";

/**
 * One VibeSession per browser, found by a cookie. Sessions live in server memory (a restart ends them; files and
 * research logs are on disk). The browser gets every change over Server-Sent Events.
 */
const sidCookie = createCookie("vl_sid", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });

type Entry = { session: VibeSession; listeners: Set<(s: Snapshot) => void> };
const g = globalThis as unknown as { __vibeSessions?: Map<string, Entry> };
// Kept on globalThis so dev-server reloads don't drop running sessions.
const sessions = (g.__vibeSessions ??= new Map<string, Entry>());

function entry(sid: string): Entry {
  let e = sessions.get(sid);
  if (!e) {
    const listeners = new Set<(s: Snapshot) => void>();
    const session = new VibeSession(sid, (s) => listeners.forEach((l) => l(s)));
    e = { session, listeners };
    sessions.set(sid, e);
  }
  return e;
}

/** The browser's session id, creating one (and the Set-Cookie header for it) if needed. */
export async function sessionFor(request: Request): Promise<{ sid: string; session: VibeSession; setCookie?: string }> {
  const existing = await sidCookie.parse(request.headers.get("Cookie"));
  if (typeof existing === "string" && /^[\w-]{8,64}$/.test(existing)) return { sid: existing, session: entry(existing).session };
  const sid = randomUUID();
  return { sid, session: entry(sid).session, setCookie: await sidCookie.serialize(sid) };
}

export function subscribe(sid: string, listener: (s: Snapshot) => void): () => void {
  const e = entry(sid);
  e.listeners.add(listener);
  return () => e.listeners.delete(listener);
}

/** Runs a browser command. Model calls can take minutes, so this isn't awaited by the request; results arrive as events. */
export function dispatch(session: VibeSession, cmd: Command) {
  const run = async () => {
    switch (cmd.type) {
      case "begin": return session.begin(String(cmd.participant ?? ""), !!cmd.consent, cmd.level ? String(cmd.level) : undefined);
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
