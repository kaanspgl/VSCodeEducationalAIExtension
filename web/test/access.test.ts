// `npm test`: the site password (SITE_PASSWORD).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { hasAccess, login, requireAccess } from "../app/.server/access.ts";

const req = (headers: Record<string, string> = {}) => new Request("http://127.0.0.1:3100/", { headers });
const cookieFrom = (setCookie: string) => setCookie.split(";")[0];

afterEach(() => {
  delete process.env.SITE_PASSWORD;
});

test("without SITE_PASSWORD the site is open", () => {
  assert.equal(hasAccess(req()), true);
  assert.doesNotThrow(() => requireAccess(req(), "page"));
});

test("with SITE_PASSWORD, pages redirect to /login and API calls get 401", () => {
  process.env.SITE_PASSWORD = "correct horse";
  assert.equal(hasAccess(req()), false);
  assert.throws(() => requireAccess(req(), "page"), (r: Response) => r.status === 302 && r.headers.get("Location") === "/login");
  assert.throws(() => requireAccess(req(), "api"), (r: Response) => r.status === 401);
  assert.equal(hasAccess(req({ Cookie: "vl_access=" + "0".repeat(64) })), false);
});

test("the right password gives a cookie that opens the site, until the password changes", async () => {
  process.env.SITE_PASSWORD = "correct horse";
  const r = await login(req({ "X-Forwarded-For": "10.0.0.1" }), "correct horse");
  assert.ok(r.ok);
  assert.match(r.setCookie, /HttpOnly; SameSite=Lax; Max-Age=\d+$/);
  const cookie = { Cookie: `vl_sid=abc; ${cookieFrom(r.setCookie)}` };
  assert.equal(hasAccess(req(cookie)), true);
  process.env.SITE_PASSWORD = "new password";
  assert.equal(hasAccess(req(cookie)), false);
});

test("behind Apache over HTTPS the cookie is Secure", async () => {
  process.env.SITE_PASSWORD = "pw";
  const r = await login(req({ "X-Forwarded-Proto": "https", "X-Forwarded-For": "10.0.0.2" }), "pw");
  assert.ok(r.ok && r.setCookie.endsWith("; Secure"));
});

test("wrong passwords are slowed down, then limited per client", { timeout: 30_000 }, async () => {
  process.env.SITE_PASSWORD = "pw";
  const from = (ip: string) => req({ "X-Forwarded-For": `1.2.3.4, ${ip}` }); // the last entry is what Apache saw
  const started = Date.now();
  const first = await login(from("10.0.0.3"), "nope");
  assert.ok(!first.ok && first.status === 401);
  assert.ok(Date.now() - started >= 900, "a wrong guess takes about a second");
  await Promise.all(Array.from({ length: 9 }, () => login(from("10.0.0.3"), "nope")));
  const blocked = await login(from("10.0.0.3"), "pw");
  assert.ok(!blocked.ok && blocked.status === 429, "even the right password waits once the limit is hit");
  assert.ok((await login(from("10.0.0.4"), "pw")).ok, "other clients aren't affected");
});
