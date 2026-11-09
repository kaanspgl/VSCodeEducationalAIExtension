import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "~/.server/access";
import { DATA_DIR } from "~/.server/config";
import { zip } from "~/.server/judge0";
import { logFile } from "~/.server/logger";
import { findParticipant, listParticipants } from "~/.server/participants";
import { participantsCsv, summaryCsv } from "~/.server/results";
import type { Route } from "./+types/admin.download";

const attachment = (body: BodyInit, name: string, type: string) =>
  new Response(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });

const readOr = (f: string) => {
  try {
    return fs.readFileSync(f);
  } catch {
    return Buffer.alloc(0);
  }
};

/** Every file under a folder, as zip entries named from `prefix`. */
function filesUnder(dir: string, prefix: string): { name: string; data: Buffer }[] {
  const out: { name: string; data: Buffer }[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const name = `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...filesUnder(full, name));
    else if (e.isFile()) out.push({ name, data: fs.readFileSync(full) });
  }
  return out;
}

/** The admin page's downloads. Participants' PIN hashes and the cookie secret are never included. */
export async function loader({ request, params }: Route.LoaderArgs) {
  requireAdmin(request);
  const list = listParticipants();
  const file = params.file;
  const stamp = new Date().toISOString().slice(0, 10);

  if (file === "summary.csv") return attachment(summaryCsv(list), `vibelearner-summary-${stamp}.csv`, "text/csv; charset=utf-8");
  if (file === "participants.csv") return attachment(participantsCsv(list), `vibelearner-participants-${stamp}.csv`, "text/csv; charset=utf-8");
  if (file === "logs.jsonl") {
    const all = Buffer.concat(list.map((p) => readOr(logFile(p.code))));
    return attachment(all, `vibelearner-logs-${stamp}.jsonl`, "application/x-ndjson");
  }
  if (file === "vibelearner-data.zip") {
    const entries = [
      { name: "participants.csv", data: Buffer.from(participantsCsv(list)) },
      { name: "summary.csv", data: Buffer.from(summaryCsv(list)) },
      ...list.filter((p) => fs.existsSync(logFile(p.code))).map((p) => ({ name: `study_logs/${path.basename(logFile(p.code))}`, data: readOr(logFile(p.code)) })),
      ...list.flatMap((p) => filesUnder(path.join(DATA_DIR, "workspaces", `p-${path.basename(logFile(p.code), ".jsonl")}`), `workspaces/p-${p.code}`)),
    ];
    return attachment(new Uint8Array(zip(entries)), `vibelearner-data-${stamp}.zip`, "application/zip");
  }
  const m = /^([A-Za-z0-9_-]{2,32})\.jsonl$/.exec(file);
  const p = m && findParticipant(m[1]);
  if (p) return attachment(readOr(logFile(p.code)), `${p.code}.jsonl`, "application/x-ndjson");
  throw new Response("Not found", { status: 404 });
}
