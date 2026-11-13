import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config";
import { safeName } from "./logger";
import { zip } from "./zip";

/**
 * Each participant's data lives under their own code and nowhere else: one log, one progress file and one
 * folder of project files (a subfolder per study part). That makes it easy to hand over one participant's
 * data, move everything to long-term storage, or delete it when someone withdraws.
 */
const LOG_DIR = path.join(DATA_DIR, "study_logs");

/** The participant's log file as it is named on disk (codes are matched without regard to case). */
async function logFile(code: string): Promise<string | undefined> {
  const want = `${safeName(code)}.jsonl`.toLowerCase();
  const name = (await fs.readdir(LOG_DIR).catch(() => [] as string[])).find((f) => f.toLowerCase() === want);
  return name && path.join(LOG_DIR, name);
}

const progressFile = (code: string) => path.join(DATA_DIR, "progress", `${safeName(code)}.json`);
const workspaceDir = (code: string) => path.join(DATA_DIR, "workspaces", `p-${safeName(code)}`);

type Entry = { name: string; data: Buffer; date?: Date };

/** Every file under a folder, as zip entries named from `prefix`. */
async function walk(dir: string, prefix: string, skip?: (rel: string) => boolean): Promise<Entry[]> {
  const out: Entry[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (skip?.(rel)) continue;
    if (e.isDirectory()) out.push(...(await walk(full, rel, skip)));
    else if (e.isFile()) out.push({ name: rel, data: await fs.readFile(full), date: (await fs.stat(full)).mtime });
  }
  return out;
}

/** One participant's log, progress and project files in one .zip; undefined if they have no data. */
export async function participantZip(code: string): Promise<Buffer | undefined> {
  const root = safeName(code);
  const files: Entry[] = [];
  const log = await logFile(code);
  if (log) files.push({ name: `${root}/log.jsonl`, data: await fs.readFile(log), date: (await fs.stat(log)).mtime });
  const progress = await fs.readFile(progressFile(code)).catch(() => undefined);
  if (progress) files.push({ name: `${root}/progress.json`, data: progress });
  files.push(...(await walk(workspaceDir(code), `${root}/files`)));
  return files.length ? zip(files) : undefined;
}

/** The whole study's data (list, plan, consent text, logs, progress, participants' files) in one .zip. */
export async function studyZip(extra: Entry[] = []): Promise<Buffer> {
  // Folders of visitors without a participant code aren't study data.
  const files = await walk(DATA_DIR, "vibelearner-data", (rel) => /^vibelearner-data\/workspaces\/anon-/.test(rel) || rel.endsWith(".tmp"));
  return zip([...files, ...extra.map((e) => ({ ...e, name: `vibelearner-data/${e.name}` }))]);
}

/** Deletes everything recorded for a participant (a withdrawal). Returns what was removed. */
export async function deleteParticipantData(code: string): Promise<string[]> {
  const removed: string[] = [];
  const log = await logFile(code);
  if (log) { await fs.rm(log, { force: true }); removed.push("log"); }
  if (await fs.stat(progressFile(code)).catch(() => undefined)) { await fs.rm(progressFile(code), { force: true }); removed.push("progress"); }
  if (await fs.stat(workspaceDir(code)).catch(() => undefined)) { await fs.rm(workspaceDir(code), { recursive: true, force: true }); removed.push("project files"); }
  return removed;
}
