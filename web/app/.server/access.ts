import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.ts";
import { checkPin, findParticipant, normalizeCode, type Participant } from "./participants.ts";

/**
 * Who may use the site.
 *
 * Participants: the consent page comes first, then the code and PIN from their card. A signed cookie (vl_user)
 * keeps them in for 12 hours and holds only the code; a new PIN signs that code out. Every page and API call
 * needs it.
 *
 * Researchers: /admin needs ADMIN_PASSWORD (cookie vl_admin, sent only to /admin). Without it, the admin pages are
 * open on a development machine (NODE_ENV=development, as with `npm run dev`) and closed everywhere else.
 *
 * Cookies are signed with SESSION_SECRET, or a random secret kept in data/.secret.
 */
const STUDENT_COOKIE = "vl_user";
const STUDENT_MAX_AGE_S = 12 * 60 * 60;
const ADMIN_COOKIE = "vl_admin";
const ADMIN_MAX_AGE_S = 12 * 60 * 60;
/** Wrong guesses allowed per client per window before it has to wait. */
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;

let fileSecret: string | undefined;
function secret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fileSecret) return fileSecret;
  const f = path.join(DATA_DIR, ".secret");
  try {
    fileSecret = fs.readFileSync(f, "utf8").trim() || undefined;
  } catch {
    /* first start */
  }
  if (!fileSecret) {
    fileSecret = randomBytes(32).toString("hex");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(f, fileSecret, { mode: 0o600 });
  }
  return fileSecret;
}

const sign = (s: string) => createHmac("sha256", secret()).update(s).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** When the browser is on HTTPS, cookies are never sent over plain HTTP. The browser's Origin header says which it
 * is (S378's Apache conf doesn't pass the scheme on); X-Forwarded-Proto covers proxies that do. */
function secureFlag(request: Request) {
  const https = request.headers.get("X-Forwarded-Proto") === "https" || /^https:\/\//i.test(request.headers.get("Origin") ?? "");
  return https ? "; Secure" : "";
}

const setCookie = (request: Request, name: string, value: string, cookiePath: string, maxAge: number) =>
  `${name}=${value}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag(request)}`;

// ------------------------------------------------------------------ participants

const studentToken = (p: Participant) => `${p.code}.${sign(`student:${p.code}:${p.pinVersion}`)}`;

export function currentStudent(request: Request): Participant | undefined {
  const v = cookie(request, STUDENT_COOKIE);
  const dot = v?.lastIndexOf(".") ?? -1;
  if (!v || dot < 1) return undefined;
  const p = findParticipant(v.slice(0, dot));
  return p && same(v, studentToken(p)) ? p : undefined;
}

/** Pages send people to the consent page; API calls get a 401. Throws the response, so loaders can just call it. */
export function requireStudent(request: Request, kind: "page" | "api"): Participant {
  const p = currentStudent(request);
  if (p) return p;
  if (kind === "page") throw new Response(null, { status: 302, headers: { Location: "/consent" } });
  throw Response.json({ error: "Sign in again: reload the page." }, { status: 401 });
}

export type LoginResult<T = undefined> = { ok: true; setCookie: string; value: T } | { ok: false; error: string; status: number };

export async function studentLogin(request: Request, code: string, pin: string): Promise<LoginResult<Participant>> {
  return limited(request, "student", "That code and PIN don't match. Check the card you were given.", () => {
    const p = findParticipant(normalizeCode(code));
    if (!checkPin(p, pin) || !p) return undefined;
    return { setCookie: setCookie(request, STUDENT_COOKIE, studentToken(p), "/", STUDENT_MAX_AGE_S), value: p };
  });
}

export const studentLogout = () => `${STUDENT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// ------------------------------------------------------------------ researchers

export const adminPassword = () => process.env.ADMIN_PASSWORD ?? "";
export const adminMode = (): "password" | "open" | "closed" =>
  adminPassword() ? "password" : process.env.NODE_ENV === "development" ? "open" : "closed";

const adminToken = () => sign(`admin:${adminPassword()}`);

export function isAdmin(request: Request): boolean {
  const mode = adminMode();
  if (mode !== "password") return mode === "open";
  const got = cookie(request, ADMIN_COOKIE);
  return !!got && same(got, adminToken());
}

export function requireAdmin(request: Request) {
  if (isAdmin(request)) return;
  if (adminMode() === "closed") throw new Response("The admin pages are off: set ADMIN_PASSWORD and restart the app.", { status: 503 });
  throw new Response(null, { status: 302, headers: { Location: "/admin/login" } });
}

export async function adminLogin(request: Request, given: string): Promise<LoginResult> {
  return limited(request, "admin", "That's not the admin password.", () => {
    const password = adminPassword();
    if (!password || !same(sign(`admin:${given}`), adminToken())) return undefined;
    return { setCookie: setCookie(request, ADMIN_COOKIE, adminToken(), "/admin", ADMIN_MAX_AGE_S), value: undefined };
  });
}

export const adminLogout = () => `${ADMIN_COOKIE}=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0`;

// ------------------------------------------------------------------ wrong guesses

/** The client as Apache saw it: Apache appends the real address to X-Forwarded-For, so the last entry is the trustworthy one. */
function clientOf(request: Request): string {
  return (request.headers.get("X-Forwarded-For") ?? "").split(",").pop()?.trim() || "direct";
}

const failures = new Map<string, { count: number; until: number }>();

/** Wrong guesses are slowed down and limited per client (separately for participants and the admin). */
async function limited<T>(request: Request, bucket: string, wrong: string, check: () => { setCookie: string; value: T } | undefined): Promise<LoginResult<T>> {
  const now = Date.now();
  const key = `${bucket}:${clientOf(request)}`;
  for (const [k, v] of failures) if (v.until < now) failures.delete(k);
  const f = failures.get(key);
  if (f && f.count >= MAX_FAILURES) return { ok: false, error: "Too many wrong tries. Wait a minute, then try again.", status: 429 };
  const r = check();
  if (r) {
    failures.delete(key);
    return { ok: true, ...r };
  }
  failures.set(key, { count: (f?.count ?? 0) + 1, until: f?.until ?? now + WINDOW_MS });
  await new Promise((res) => setTimeout(res, 1000));
  return { ok: false, error: wrong, status: 401 };
}
