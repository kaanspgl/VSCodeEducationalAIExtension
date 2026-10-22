import { dispatch, sessionFor } from "~/.server/sessions";
import type { Command } from "~/lib/types";
import type { Route } from "./+types/api.command";

const TYPES = new Set<Command["type"]>(["begin", "send", "action", "quizAnswer", "open", "save", "select", "closeDiff"]);

/** A command from the browser. Answers at once; what it changes arrives over /api/events. */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST" || !request.headers.get("Content-Type")?.includes("application/json")) {
    return Response.json({ error: "POST JSON only" }, { status: 400 });
  }
  const { session, setCookie } = await sessionFor(request);
  if (setCookie) return Response.json({ error: "No session: reload the page" }, { status: 401 });
  const cmd = (await request.json().catch(() => undefined)) as Command | undefined;
  if (!cmd || !TYPES.has(cmd.type)) return Response.json({ error: "Unknown command" }, { status: 400 });
  dispatch(session, cmd);
  return Response.json({ ok: true });
}
