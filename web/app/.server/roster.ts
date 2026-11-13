import fs from "node:fs";
import path from "node:path";
import type { Level } from "~/lib/types";
import { DATA_DIR } from "./config";

/**
 * The study's participant list (data/roster.json): which codes may start a research session and which
 * condition each one gets. While the list is empty, any code is accepted and the condition comes from
 * settings, as before. Once it has codes, only those codes work and each gets its own condition.
 */
/** `withdrawn` is the date a participant withdrew: the code stays on the list so it can't be handed out again. */
export type RosterEntry = { code: string; level: Level; added: string; withdrawn?: string };

const FILE = path.join(DATA_DIR, "roster.json");
export const CODE_RE = /^[A-Za-z0-9_-]{2,32}$/;

export function readRoster(): RosterEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const list = Array.isArray(raw?.participants) ? raw.participants : [];
    return list.filter((e: any) => typeof e?.code === "string" && CODE_RE.test(e.code) && ["guided", "off", "light"].includes(e.level));
  } catch {
    return [];
  }
}

function writeRoster(list: RosterEntry[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Write to a temporary file first, so a crash mid-write can't leave a broken list.
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ participants: list }, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, FILE);
}

/** Codes are matched without regard to case, so "p014" is the same participant as "P014". */
export function findParticipant(code: string, list = readRoster()): RosterEntry | undefined {
  const c = code.trim().toLowerCase();
  return list.find((e) => e.code.toLowerCase() === c);
}

/**
 * Adds codes with a condition. "random" puts each new code in whichever of structured / regular has fewer
 * participants so far (a coin flip when they are level), which keeps the two groups the same size.
 */
export function addParticipants(codes: string[], level: Level | "random"): { added: RosterEntry[]; skipped: string[] } {
  const list = readRoster();
  const added: RosterEntry[] = [];
  const skipped: string[] = [];
  for (const raw of codes) {
    const code = raw.trim();
    if (!code) continue;
    if (!CODE_RE.test(code) || findParticipant(code, list)) { skipped.push(code); continue; }
    let lv: Level;
    if (level === "random") {
      // Someone who withdrew no longer counts, so the next code fills the gap they left.
      const guided = list.filter((e) => e.level === "guided" && !e.withdrawn).length;
      const off = list.filter((e) => e.level === "off" && !e.withdrawn).length;
      lv = guided < off ? "guided" : off < guided ? "off" : Math.random() < 0.5 ? "guided" : "off";
    } else lv = level;
    const entry = { code, level: lv, added: new Date().toISOString() };
    list.push(entry);
    added.push(entry);
  }
  if (added.length) writeRoster(list);
  return { added, skipped };
}

/** Takes a code off the list. Its log and files stay on disk. */
export function removeParticipant(code: string): boolean {
  const list = readRoster();
  const entry = findParticipant(code, list);
  if (!entry) return false;
  writeRoster(list.filter((e) => e !== entry));
  return true;
}

/** Marks a participant as withdrawn. Their code stays on the list, but can no longer sign in. */
export function withdrawParticipant(code: string): boolean {
  const list = readRoster();
  const entry = findParticipant(code, list);
  if (!entry) return false;
  entry.withdrawn = new Date().toISOString();
  writeRoster(list);
  return true;
}
