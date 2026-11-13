import { isAdmin, participantSummaries, summariesCsv } from "~/.server/admin";
import type { Route } from "./+types/admin.export";

/** Every participant's summary as one CSV file (signed-in researchers only). */
export async function loader({ request }: Route.LoaderArgs) {
  if (!(await isAdmin(request))) return new Response("Sign in at /admin first.", { status: 401 });
  return new Response(summariesCsv(await participantSummaries()), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="vibelearner-participants.csv"', "Cache-Control": "no-store" },
  });
}
