import { randomUUID } from "node:crypto";
import { createCookie } from "react-router";
import type { Command, Snapshot } from "~/lib/types";
import { VibeSession } from "./session";

/**
 * One VibeSession per browser, found by a cookie. Sessions live in server memory (a restart ends them; files and
 * research logs are on disk). The browser gets every change over Server-Sent Events.
 */
/**
 * VL_EMBEDDED=1 lets the app run inside another site's frame (a hosted preview, a demo embedded in a page):
 * its cookies are then sent there too, and only over HTTPS or localhost. Leave it off for a study.
 */
export const embedded = () => ["1", "true"].includes(String(process.env.VL_EMBEDDED ?? "").toLowerCase());
export const cookieSite = () => (embedded() ? ({ sameSite: "none", secure: true } as const) : ({ sameSite: "lax" } as const));

const sidCookie = createCookie("vl_sid", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });

type Entry = { session: VibeSession; listeners: Set<(s: Snapshot) => void>; emit: (s: Snapshot) => void };
const g = globalThis as unknown as { __vibeSessions?: Map<string, Entry> };
// Kept on globalThis so dev-server reloads don't drop running sessions.
const sessions = (g.__vibeSessions ??= new Map<string, Entry>());

/** A session for this browser. Only the browser's current session is heard: one that was replaced can't overwrite the screen. */
function fresh(e: Entry, sid: string): VibeSession {
  const session: VibeSession = new VibeSession(sid, (s) => { if (e.session === session) e.emit(s); });
  return session;
}

function entry(sid: string): Entry {
  let e = sessions.get(sid);
  if (!e) {
    const listeners = new Set<(s: Snapshot) => void>();
    const emit = (s: Snapshot) => listeners.forEach((l) => l(s));
    e = { session: undefined as unknown as VibeSession, listeners, emit };
    e.session = fresh(e, sid);
    sessions.set(sid, e);
  }
  return e;
}

/** The browser's session id, creating one (and the Set-Cookie header for it) if needed. */
export async function sessionFor(request: Request): Promise<{ sid: string; session: VibeSession; setCookie?: string }> {
  const existing = await sidCookie.parse(request.headers.get("Cookie"));
  if (typeof existing === "string" && /^[\w-]{8,64}$/.test(existing)) return { sid: existing, session: entry(existing).session };
  const sid = randomUUID();
  return { sid, session: entry(sid).session, setCookie: await sidCookie.serialize(sid, cookieSite()) };
}

/**
 * Ends every live session signed in with this code and sends its browser back to the start. Used when a
 * participant is withdrawn or sent back to the start of the plan: a tab left open must not go on recording
 * under the code, or carry on from where the participant used to be.
 */
export async function endSessionsFor(code: string) {
  const want = code.trim().toLowerCase();
  for (const [sid, e] of sessions) {
    if (!want || e.session.participant.toLowerCase() !== want) continue;
    const old = e.session;
    e.session = fresh(e, sid);
    await old.silence();
    e.emit(e.session.snapshot());
  }
}

export function subscribe(sid: string, listener: (s: Snapshot) => void): () => void {
  const e = entry(sid);
  e.listeners.add(listener);
  return () => e.listeners.delete(listener);
}

/** Runs a browser command. Model calls can take minutes, so this isn't awaited by the request; results arrive as events. */
export function dispatch(sid: string, cmd: Command) {
  const e = entry(sid);
  const session = e.session;
  if (cmd.type === "reset") {
    // Sign out: the next person at this browser starts from the start screen. Logs, files and study progress stay on disk.
    session.signOut();
    e.session = fresh(e, sid);
    e.emit(e.session.snapshot());
    return;
  }
  const run = async () => {
    await step();
    // The participant moved on to the next study part: it starts as a fresh session (new conversation, new
    // condition, new folder), signed in with the same code.
    if (session.restart && e.session === session) {
      e.session = fresh(e, sid);
      await e.session.begin(session.participant, true, undefined, true);
    }
  };
  const step = async () => {
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
  run().catch((err) => e.session.reportError(err));
}
