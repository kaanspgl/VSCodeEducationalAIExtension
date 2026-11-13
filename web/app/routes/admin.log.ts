import { isAdmin, readLog } from "~/.server/admin";
import { safeName } from "~/.server/logger";
import { CODE_RE } from "~/.server/roster";
import type { Route } from "./+types/admin.log";

/** One participant's raw JSONL log as a download (signed-in researchers only). */
export async function loader({ request, params }: Route.LoaderArgs) {
  if (!(await isAdmin(request))) return new Response("Sign in at /admin first.", { status: 401 });
  const code = params.code ?? "";
  const log = CODE_RE.test(code) ? await readLog(code) : undefined;
  if (log === undefined) return new Response("No log for that participant.", { status: 404 });
  return new Response(log, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": `attachment; filename="${safeName(code)}.jsonl"`, "Cache-Control": "no-store" },
  });
}
