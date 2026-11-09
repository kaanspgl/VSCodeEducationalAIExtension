// `npm test`: participants' sign-in (code + PIN after consent) and the researchers' admin password.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, test } from "node:test";

// The data folder is read when the modules load, so point it at a scratch folder first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-access-"));
process.env.VL_DATA_DIR = dir;
const { adminLogin, adminMode, currentStudent, isAdmin, requireAdmin, requireStudent, studentLogin } = await import("../app/.server/access.ts");
const { createParticipants, resetPin } = await import("../app/.server/participants.ts");

after(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  delete process.env.ADMIN_PASSWORD;
  delete process.env.NODE_ENV;
});

let ip = 0;
/** Each test signs in from its own address, so wrong guesses in one don't lock out another. */
const req = (headers: Record<string, string> = {}) => new Request("http://127.0.0.1:3100/", { headers: { "X-Forwarded-For": `10.1.0.${++ip}`, ...headers } });
const cookieFrom = (setCookie: string) => setCookie.split(";")[0];

test("without the sign-in cookie, pages go to the consent page and API calls get 401", () => {
  assert.equal(currentStudent(req()), undefined);
  assert.throws(() => requireStudent(req(), "page"), (r: Response) => r.status === 302 && r.headers.get("Location") === "/consent");
  assert.throws(() => requireStudent(req(), "api"), (r: Response) => r.status === 401);
  assert.equal(currentStudent(req({ Cookie: "vl_user=P001." + "0".repeat(64) })), undefined, "a made-up cookie doesn't work");
});

test("the code and PIN from the card sign in; the cookie holds only the code", async () => {
  const [{ code, pin }] = createParticipants(1, "structured-first");
  const r = await studentLogin(req(), code.toLowerCase(), ` ${pin} `);
  assert.ok(r.ok, "codes aren't case-sensitive and spaces around the PIN are ignored");
  assert.match(r.setCookie, new RegExp(`^vl_user=${code}\\.[0-9a-f]{64}; Path=/; HttpOnly; SameSite=Lax; Max-Age=\\d+$`));
  assert.equal(r.value.code, code);
  const p = currentStudent(req({ Cookie: `other=1; ${cookieFrom(r.setCookie)}` }));
  assert.equal(p?.code, code);
});

test("a wrong PIN, or someone else's, doesn't sign in", async () => {
  const [a, b] = createParticipants(2, "structured-first");
  const wrong = await studentLogin(req(), a.code, b.pin === a.pin ? "000000x" : b.pin);
  assert.ok(!wrong.ok && wrong.status === 401);
  const unknown = await studentLogin(req(), "NOPE99", a.pin);
  assert.ok(!unknown.ok && unknown.status === 401);
});

test("a cookie can't be moved to another code", async () => {
  const [a, b] = createParticipants(2, "structured-first");
  const r = await studentLogin(req(), a.code, a.pin);
  assert.ok(r.ok);
  const sig = cookieFrom(r.setCookie).split(".").pop();
  assert.equal(currentStudent(req({ Cookie: `vl_user=${b.code}.${sig}` })), undefined);
});

test("a new PIN signs the code out and the old PIN stops working", async () => {
  const [{ code, pin }] = createParticipants(1, "regular-first");
  const r = await studentLogin(req(), code, pin);
  assert.ok(r.ok);
  const cookie = { Cookie: cookieFrom(r.setCookie) };
  const fresh = resetPin(code)!;
  assert.equal(currentStudent(req(cookie)), undefined);
  assert.ok(!(await studentLogin(req(), code, pin)).ok);
  assert.ok((await studentLogin(req(), code, fresh)).ok);
});

test("behind Apache over HTTPS the cookie is Secure, and plain HTTP on a laptop still works", async () => {
  const [{ code, pin }] = createParticipants(1, "structured-first");
  const https = await studentLogin(req({ Origin: "https://dev.sandbox.ok.ubc.ca" }), code, pin);
  assert.ok(https.ok && https.setCookie.endsWith("; Secure"));
  const proxied = await studentLogin(req({ "X-Forwarded-Proto": "https" }), code, pin);
  assert.ok(proxied.ok && proxied.setCookie.endsWith("; Secure"));
  const http = await studentLogin(req({ Origin: "http://127.0.0.1:3100" }), code, pin);
  assert.ok(http.ok && !http.setCookie.includes("Secure"));
});

test("wrong PINs are slowed down, then limited per client", { timeout: 30_000 }, async () => {
  const [{ code, pin }] = createParticipants(1, "structured-first");
  const from = (addr: string) => new Request("http://127.0.0.1:3100/", { headers: { "X-Forwarded-For": `1.2.3.4, ${addr}` } }); // the last entry is what Apache saw
  const started = Date.now();
  const first = await studentLogin(from("10.9.0.1"), code, "nope");
  assert.ok(!first.ok && first.status === 401);
  assert.ok(Date.now() - started >= 900, "a wrong guess takes about a second");
  await Promise.all(Array.from({ length: 9 }, () => studentLogin(from("10.9.0.1"), code, "nope")));
  const blocked = await studentLogin(from("10.9.0.1"), code, pin);
  assert.ok(!blocked.ok && blocked.status === 429, "even the right PIN waits once the limit is hit");
  assert.ok((await studentLogin(from("10.9.0.2"), code, pin)).ok, "other clients aren't affected");
});

test("admin pages: closed in production without ADMIN_PASSWORD, open on a dev server", () => {
  assert.equal(adminMode(), "closed");
  assert.throws(() => requireAdmin(req()), (r: Response) => r.status === 503);
  process.env.NODE_ENV = "development";
  assert.equal(adminMode(), "open");
  assert.equal(isAdmin(req()), true);
});

test("with ADMIN_PASSWORD, the admin needs it; the cookie is sent only to /admin and dies when it changes", async () => {
  process.env.ADMIN_PASSWORD = "research team";
  process.env.NODE_ENV = "development"; // the password wins even on a dev server
  assert.throws(() => requireAdmin(req()), (r: Response) => r.status === 302 && r.headers.get("Location") === "/admin/login");
  assert.ok(!(await adminLogin(req(), "nope")).ok);
  const r = await adminLogin(req(), "research team");
  assert.ok(r.ok);
  assert.match(r.setCookie, /^vl_admin=[0-9a-f]{64}; Path=\/admin; /);
  const cookie = { Cookie: cookieFrom(r.setCookie) };
  assert.equal(isAdmin(req(cookie)), true);
  process.env.ADMIN_PASSWORD = "new password";
  assert.equal(isAdmin(req(cookie)), false);
});

test("a participant's cookie doesn't open the admin pages", async () => {
  process.env.ADMIN_PASSWORD = "research team";
  const [{ code, pin }] = createParticipants(1, "structured-first");
  const r = await studentLogin(req(), code, pin);
  assert.ok(r.ok);
  const value = cookieFrom(r.setCookie).split("=")[1];
  assert.equal(isAdmin(req({ Cookie: `vl_admin=${value}` })), false);
});
