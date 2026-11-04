import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Site password (SITE_PASSWORD). When it's set, every page and API call needs the access cookie, which the
 * password page (/login) gives out. The cookie holds an HMAC of the password, so changing the password signs
 * everyone out. Without SITE_PASSWORD the site is open (local development).
 */
const COOKIE = "vl_access";
const MAX_AGE_S = 60 * 60 * 24 * 30;
/** Wrong guesses allowed per client per window before it has to wait. */
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;

export const sitePassword = () => process.env.SITE_PASSWORD ?? "";

let warned = false;
export function warnIfOpen() {
  if (!sitePassword() && process.env.NODE_ENV === "production" && !warned) {
    warned = true;
    console.warn("[access] SITE_PASSWORD is not set: anyone who can reach this site can use it.");
  }
}

const tokenFor = (password: string) => createHmac("sha256", password).update("vibelearner-site-access-v1").digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function cookieValue(request: Request): string | undefined {
  const m = /(?:^|;\s*)vl_access=([0-9a-f]{64})(?:;|$)/.exec(request.headers.get("Cookie") ?? "");
  return m?.[1];
}

export function hasAccess(request: Request): boolean {
  const password = sitePassword();
  if (!password) return true;
  const got = cookieValue(request);
  return !!got && same(got, tokenFor(password));
}

/** Pages send people to the password page; API calls get a 401. Throws the response, so loaders can just call it. */
export function requireAccess(request: Request, kind: "page" | "api") {
  warnIfOpen();
  if (hasAccess(request)) return;
  if (kind === "page") throw new Response(null, { status: 302, headers: { Location: "/login" } });
  throw Response.json({ error: "Enter the site password first: reload the page." }, { status: 401 });
}

/** The client as Apache saw it: Apache appends the real address to X-Forwarded-For, so the last entry is the trustworthy one. */
function clientOf(request: Request): string {
  return (request.headers.get("X-Forwarded-For") ?? "").split(",").pop()?.trim() || "direct";
}

const failures = new Map<string, { count: number; until: number }>();

export type LoginResult = { ok: true; setCookie: string } | { ok: false; error: string; status: number };

/** Checks a password from the form. Wrong guesses are slowed down and limited per client. */
export async function login(request: Request, given: string): Promise<LoginResult> {
  const password = sitePassword();
  const now = Date.now();
  const client = clientOf(request);
  for (const [k, v] of failures) if (v.until < now) failures.delete(k);
  const f = failures.get(client);
  if (f && f.count >= MAX_FAILURES) return { ok: false, error: "Too many wrong tries. Wait a minute, then try again.", status: 429 };

  if (password && same(tokenFor(given), tokenFor(password))) {
    failures.delete(client);
    // Apache tells the app the browser used HTTPS (see DEPLOY.md), so the cookie is never sent over plain HTTP.
    const secure = request.headers.get("X-Forwarded-Proto") === "https" ? "; Secure" : "";
    return { ok: true, setCookie: `${COOKIE}=${tokenFor(password)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}` };
  }
  failures.set(client, { count: (f?.count ?? 0) + 1, until: f?.until ?? now + WINDOW_MS });
  await new Promise((r) => setTimeout(r, 1000));
  return { ok: false, error: "That's not the password.", status: 401 };
}
