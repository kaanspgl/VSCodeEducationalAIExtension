import { requireStudent } from "~/.server/access";
import { PARTS } from "~/.server/participants";
import { dispatch, finishCurrentPart, sessionFor } from "~/.server/sessions";
import type { Command } from "~/lib/types";
import type { Route } from "./+types/api.command";

const TYPES = new Set<Command["type"]>(["finishPart", "send", "action", "quizAnswer", "open", "save", "select", "closeDiff"]);

/** A command from the browser. Answers at once; what it changes arrives over /api/events. */
export async function action({ request }: Route.ActionArgs) {
  const p = requireStudent(request, "api");
  if (request.method !== "POST" || !request.headers.get("Content-Type")?.includes("application/json")) {
    return Response.json({ error: "POST JSON only" }, { status: 400 });
  }
  const cmd = (await request.json().catch(() => undefined)) as Command | undefined;
  if (!cmd || !TYPES.has(cmd.type)) return Response.json({ error: "Unknown command" }, { status: 400 });
  // Finished both parts (or moved on in another tab): the page reloads to show where they are now.
  if (p.part > PARTS) return Response.json({ reload: true });
  if (cmd.type === "finishPart") {
    await finishCurrentPart(p);
    return Response.json({ reload: true });
  }
  const { session } = await sessionFor(p);
  dispatch(session, cmd);
  return Response.json({ ok: true });
}
