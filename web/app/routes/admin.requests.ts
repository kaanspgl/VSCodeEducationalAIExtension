import { firstRequests, isAdmin, requestsCsv } from "~/.server/admin";
import type { Route } from "./+types/admin.requests";

/**
 * The first request for each task, for scoring how completely it describes the program (signed-in researchers
 * only). /admin/requests.csv hides who wrote each request and in which mode; /admin/requests-key.csv is the key.
 */
export async function loader({ request }: Route.LoaderArgs) {
  if (!(await isAdmin(request))) return new Response("Sign in at /admin first.", { status: 401 });
  const key = new URL(request.url).pathname.endsWith("-key.csv");
  return new Response(requestsCsv(await firstRequests(), !key), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${key ? "vibelearner-requests-key.csv" : "vibelearner-requests-to-score.csv"}"`,
    },
  });
}
