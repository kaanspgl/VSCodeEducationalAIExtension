import { firstRequests, isAdmin, participantSummaries, requestsCsv, summariesCsv } from "~/.server/admin";
import { participantZip, studyZip } from "~/.server/data";
import { safeName } from "~/.server/logger";
import { CODE_RE } from "~/.server/roster";
import type { Route } from "./+types/admin.data";

/** Data downloads (signed-in researchers only): one participant's log and files, or the whole study, as a .zip. */
export async function loader({ request, params }: Route.LoaderArgs) {
  if (!(await isAdmin(request))) return new Response("Sign in at /admin first.", { status: 401 });
  const send = (zip: Buffer, name: string) => new Response(new Uint8Array(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
  const code = params.code;
  if (code === undefined) {
    // The summary and the scoring files go in too, as they stood when the data was taken off the server.
    const requests = await firstRequests();
    const text = (name: string, s: string) => ({ name: `exports/${name}`, data: Buffer.from(s, "utf8") });
    return send(await studyZip([
      text("summary.csv", summariesCsv(await participantSummaries())),
      text("requests-to-score.csv", requestsCsv(requests, true)),
      text("requests-key.csv", requestsCsv(requests, false)),
    ]), `vibelearner-data-${new Date().toISOString().slice(0, 10)}.zip`);
  }
  const zip = CODE_RE.test(code) ? await participantZip(code) : undefined;
  if (!zip) return new Response("No data for that participant.", { status: 404 });
  return send(zip, `${safeName(code)}.zip`);
}
