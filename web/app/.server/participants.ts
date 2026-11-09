import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.ts";

/**
 * Study participants (data/participants.json). The admin page makes the codes; each code gets a PIN for its card
 * and an order for the two parts: one part in structured vibe coding, the other in regular vibe coding, each on its
 * own project folder. No names are stored. PINs are kept only as scrypt hashes, so a lost card means a new PIN.
 *
 * Uses only Node built-ins and erasable TypeScript, so the tests can import it directly.
 */

export type Condition = "guided" | "off";
export const CONDITION_LABEL: Record<Condition, string> = { guided: "Structured", off: "Regular" };
export const PARTS = 2;

export type Participant = {
  code: string;
  pinSalt: string;
  pinHash: string;
  /** Goes up whenever the PIN changes, which signs that code out everywhere. */
  pinVersion: number;
  /** The condition of part 1 and part 2. */
  order: Condition[];
  /** The part they're on: 1 or 2, or 3 once both are finished. */
  part: number;
  parts: { startedAt?: string; finishedAt?: string }[];
  createdAt: string;
  consent?: { at: string; version: string };
};

export type OrderMode = "structured-first" | "regular-first" | "counterbalanced";

const file = () => path.join(DATA_DIR, "participants.json");

function load(): Participant[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file(), "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  // A damaged file throws rather than reading as empty, so it's never overwritten with nothing.
  return (JSON.parse(raw).participants ?? []) as Participant[];
}

/** Sync read-modify-write: Node runs one at a time, and the rename means a crash never leaves half a file. */
function save(list: Participant[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ participants: list }, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file());
}

function update<T>(code: string, fn: (p: Participant) => T): T | undefined {
  const list = load();
  const p = list.find((x) => x.code === normalizeCode(code));
  if (!p) return undefined;
  const r = fn(p);
  save(list);
  return r;
}

export const normalizeCode = (s: string) => String(s ?? "").trim().toUpperCase();
export const isValidCode = (s: string) => /^[A-Z0-9_-]{2,32}$/.test(s);

export function listParticipants(): Participant[] {
  return load();
}

export function findParticipant(code: string): Participant | undefined {
  const c = normalizeCode(code);
  return isValidCode(c) ? load().find((p) => p.code === c) : undefined;
}

export const conditionFor = (p: Participant, part = p.part): Condition | undefined => p.order[part - 1];

const newPin = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
const hashPin = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString("hex");

export function checkPin(p: Participant | undefined, pin: string): boolean {
  // Hash even for an unknown code, so the answer takes the same time either way.
  const got = Buffer.from(hashPin(String(pin ?? "").trim(), p?.pinSalt ?? "no-such-code"), "hex");
  if (!p) return false;
  const want = Buffer.from(p.pinHash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

function withPin(p: Omit<Participant, "pinSalt" | "pinHash">, pin: string): Participant {
  const pinSalt = randomBytes(16).toString("hex");
  return { ...p, pinSalt, pinHash: hashPin(pin, pinSalt) };
}

/** Makes `count` new codes (P001, P002, … after the highest existing one). The PINs are returned only here. */
export function createParticipants(count: number, mode: OrderMode, prefix = "P"): { code: string; pin: string; order: Condition[] }[] {
  const n = Math.max(1, Math.min(200, Math.floor(count)));
  const pre = normalizeCode(prefix).replace(/[^A-Z]/g, "") || "P";
  const list = load();
  const re = new RegExp(`^${pre}(\\d+)$`);
  let next = list.reduce((m, p) => Math.max(m, Number(re.exec(p.code)?.[1] ?? 0)), 0) + 1;

  const orders: Condition[][] = [];
  while (orders.length < n) {
    if (mode === "structured-first") orders.push(["guided", "off"]);
    else if (mode === "regular-first") orders.push(["off", "guided"]);
    else {
      // Shuffled blocks of two: every pair of codes has one of each order.
      const block: Condition[][] = [["guided", "off"], ["off", "guided"]];
      if (randomInt(2)) block.reverse();
      orders.push(...block);
    }
  }

  const made: { code: string; pin: string; order: Condition[] }[] = [];
  const now = new Date().toISOString();
  for (let i = 0; i < n; i++) {
    const code = `${pre}${String(next++).padStart(3, "0")}`;
    const pin = newPin();
    const order = orders[i];
    list.push(withPin({ code, pinVersion: 1, order, part: 1, parts: [{}, {}], createdAt: now }, pin));
    made.push({ code, pin, order });
  }
  save(list);
  return made;
}

/** A new PIN for a lost card. The old one stops working, and anyone signed in with it is signed out. */
export function resetPin(code: string): string | undefined {
  const pin = newPin();
  return update(code, (p) => {
    const next = withPin({ ...p, pinVersion: p.pinVersion + 1 }, pin);
    Object.assign(p, next);
    return pin;
  });
}

/** Records consent the first time a code signs in; returns true if this was that first time. */
export function recordConsent(code: string, version: string): boolean {
  return update(code, (p) => {
    if (p.consent) return false;
    p.consent = { at: new Date().toISOString(), version };
    return true;
  }) ?? false;
}

export function markPartStarted(code: string, part: number) {
  update(code, (p) => {
    const rec = p.parts[part - 1];
    if (rec && !rec.startedAt) rec.startedAt = new Date().toISOString();
  });
}

/** The participant pressed "Finish part N": move them on (only from the part they're on, so a double click can't skip one). */
export function finishPart(code: string, part: number): Participant | undefined {
  return update(code, (p) => {
    if (p.part !== part || part > PARTS) return p;
    p.parts[part - 1].finishedAt = new Date().toISOString();
    p.part = part + 1;
    return p;
  });
}

/** Admin: put a participant on a part (e.g. after "Finish" was pressed by mistake). 3 means finished. */
export function setPart(code: string, part: number) {
  update(code, (p) => {
    if (!(part >= 1 && part <= PARTS + 1)) return;
    p.part = part;
    for (let i = part - 1; i < PARTS; i++) delete p.parts[i].finishedAt;
  });
}
