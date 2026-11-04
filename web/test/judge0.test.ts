// `npm test`: the Judge0 runner against a stand-in server that speaks the parts of the Judge0 CE API the app uses
// (languages, submit, poll, base64, auth header, additional_files). JavaScript really runs, with this Node, in a
// throwaway "box" folder; Python is only recorded, since the point is what gets sent.
import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { collectFiles, judge0Options, runOnJudge0, zip, type Judge0Options } from "../app/.server/judge0.ts";

type Submission = { language_id: number; source_code: string; stdin: string; additional_files?: string; enable_network: boolean; cpu_time_limit: number; wall_time_limit: number };

const TOKEN = "test-token";
const LANGS = [
  { id: 70, name: "Python (2.7.17)", source_file: "script.py" },
  { id: 71, name: "Python (3.8.1)", source_file: "script.py" },
  { id: 63, name: "JavaScript (Node.js 12.14.0)", source_file: "script.js" },
  { id: 62, name: "Java (OpenJDK 13.0.1)", source_file: "Main.java" },
];
const submissions: Submission[] = [];
const results = new Map<string, { polls: number; result: Record<string, unknown> }>();
let server: http.Server;
let url = "";

/** Reads the stored .zip entries back (the format Judge0 is sent), independently of the writer's bookkeeping. */
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    assert.equal(buf.readUInt16LE(p + 8), 0, "stored entries only");
    const size = buf.readUInt32LE(p + 18), nameLen = buf.readUInt16LE(p + 26), extra = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString("utf8");
    const start = p + 30 + nameLen + extra;
    out[name] = buf.subarray(start, start + size);
    p = start + size;
  }
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50, "end of central directory");
  return out;
}

function judge(sub: Submission): Record<string, unknown> {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const code = Buffer.from(sub.source_code, "base64").toString("utf8");
  if (sub.language_id !== 63) return { stdout: b64("python ran\n"), stderr: null, status: { id: 3, description: "Accepted" } };
  if (code.includes("LOOP_FOREVER")) return { stdout: null, stderr: null, status: { id: 5, description: "Time Limit Exceeded" } };
  if (code.includes("BREAK_JUDGE0")) return { stdout: null, stderr: null, message: b64("isolate crashed"), status: { id: 13, description: "Internal Error" } };
  if (code.includes("KILL_ME")) return { stdout: b64("partial\n"), stderr: null, message: b64("Exited with signal 9"), status: { id: 12, description: "Runtime Error (Other)" } };
  const box = fs.mkdtempSync(path.join(os.tmpdir(), "fake-judge0-"));
  try {
    for (const [name, data] of Object.entries(sub.additional_files ? unzip(Buffer.from(sub.additional_files, "base64")) : {})) {
      fs.mkdirSync(path.join(box, path.dirname(name)), { recursive: true });
      fs.writeFileSync(path.join(box, name), data);
    }
    fs.writeFileSync(path.join(box, "script.js"), code);
    const r = cp.spawnSync(process.execPath, [path.join(box, "script.js")], { cwd: box, input: Buffer.from(sub.stdin, "base64"), timeout: 5000 });
    // Judge0 runs from /box, so that's the path its stack traces show.
    const fix = (b: Buffer) => b.toString("utf8").split(path.join(box, "script.js")).join("/box/script.js");
    return { stdout: b64(fix(r.stdout)), stderr: b64(fix(r.stderr)), status: r.status === 0 ? { id: 3, description: "Accepted" } : { id: 11, description: "Runtime Error (NZEC)" } };
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
}

before(async () => {
  server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-auth-token"] !== TOKEN) return send(401, { error: "Authentication failed." });
    const u = new URL(req.url ?? "/", "http://x");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "GET" && u.pathname === "/languages") return send(200, LANGS.map(({ id, name }) => ({ id, name })));
      const lang = /^\/languages\/(\d+)$/.exec(u.pathname);
      if (req.method === "GET" && lang) return send(200, LANGS.find((l) => l.id === Number(lang[1])));
      if (req.method === "POST" && u.pathname === "/submissions") {
        assert.equal(u.searchParams.get("base64_encoded"), "true");
        const sub = JSON.parse(body) as Submission;
        if (!LANGS.some((l) => l.id === sub.language_id)) return send(422, { language_id: [`language with id ${sub.language_id} doesn't exist`] });
        submissions.push(sub);
        const token = `t${submissions.length}`;
        results.set(token, { polls: 0, result: judge(sub) });
        return send(201, { token });
      }
      const poll = /^\/submissions\/([\w-]+)$/.exec(u.pathname);
      if (req.method === "GET" && poll && results.has(poll[1])) {
        const r = results.get(poll[1])!;
        // The first poll finds it still processing, like a real queue.
        if (r.polls++ === 0) return send(200, { stdout: null, stderr: null, status: { id: 2, description: "Processing" } });
        return send(200, r.result);
      }
      send(404, { error: "not found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

const options = (over: Partial<Judge0Options> = {}): Judge0Options => ({ url, authHeader: "X-Auth-Token", authToken: TOKEN, languageIds: {}, ...over });
const settings = (values: Record<string, unknown>) => ({ get: <T>(k: string) => values[k] as T | undefined });

/** A participant project: main.js imports a helper from a subfolder and reads stdin; node_modules must not be sent. */
function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-project-"));
  fs.mkdirSync(path.join(dir, "lib"));
  fs.mkdirSync(path.join(dir, "node_modules", "big"), { recursive: true });
  fs.writeFileSync(path.join(dir, "lib", "helper.js"), "exports.twice = (x) => 2 * x;\n");
  fs.writeFileSync(path.join(dir, "node_modules", "big", "index.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(dir, "data.txt"), "21\n");
  return dir;
}

test("settings: Judge0 is used when a URL is set, unless runner is local", () => {
  assert.equal(judge0Options(settings({})), undefined);
  assert.equal(judge0Options(settings({ "judge0.url": "http://j:2358", runner: "local" })), undefined);
  const o = judge0Options(settings({ "judge0.url": "http://j:2358/", "judge0.authToken": "abc", "judge0.pythonLanguageId": "92" }));
  assert.equal(o?.url, "http://j:2358");
  assert.equal(o?.authHeader, "X-Auth-Token");
  assert.equal(o?.languageIds.python, 92);
  // Asking for Judge0 without a URL must not fall back to running here.
  assert.ok(judge0Options(settings({ runner: "judge0" })));
});

test("a project file runs with its folder's files, input and no network", async () => {
  const dir = project();
  const code = 'const h = require("./lib/helper");\nconst n = Number(require("fs").readFileSync(0, "utf8"));\nconsole.log(h.twice(n), require("fs").readFileSync("data.txt", "utf8").trim());\n';
  fs.writeFileSync(path.join(dir, "main.js"), code);
  const files = await collectFiles(dir);
  assert.deepEqual(files.map((f) => f.name), ["data.txt", "lib/helper.js", "main.js"]);

  const run = await runOnJudge0(options(), "javascript", code, "21\n", { name: "main.js", files });
  assert.deepEqual(run, { ok: true, stdout: "42 21\n", stderr: "", timedOut: false });
  const sub = submissions.at(-1)!;
  assert.equal(sub.language_id, 63);
  assert.equal(sub.enable_network, false);
  assert.equal(sub.wall_time_limit, 8);
  assert.equal(Buffer.from(sub.stdin, "base64").toString(), "21\n");
});

test("a crash reports the student's file name, not Judge0's script.js", async () => {
  const run = await runOnJudge0(options(), "javascript", 'console.log("before");\nthrow new Error("boom");\n', "", { name: "main.js" });
  assert.equal(run.ok, false);
  assert.equal(run.timedOut, false);
  assert.equal(run.stdout, "before\n");
  assert.match(run.stderr, /main\.js:2/);
  assert.match(run.stderr, /Error: boom/);
  assert.doesNotMatch(run.stderr, /script\.js/);
  // "$&" in a file name must come through literally, not as a replacement pattern.
  const odd = await runOnJudge0(options(), "javascript", "throw new Error('x');\n", "", { name: "a$&b.js" });
  assert.match(odd.stderr, /a\$&b\.js:1/);
});

test("a program killed without an error message says why", async () => {
  const run = await runOnJudge0(options(), "javascript", "// KILL_ME", "", { name: "big.js" });
  assert.deepEqual(run, { ok: false, stdout: "partial\n", stderr: "Runtime Error (Other): Exited with signal 9", timedOut: false });
});

test("the newest Python 3 is picked, and code and input are sent base64", async () => {
  const run = await runOnJudge0(options(), "python", 'print("héllo")\n', "x\n", { name: "program.py" });
  assert.equal(run.ok, true);
  const sub = submissions.at(-1)!;
  assert.equal(sub.language_id, 71);
  assert.equal(Buffer.from(sub.source_code, "base64").toString("utf8"), 'print("héllo")\n');
  assert.equal(sub.additional_files, undefined);
});

test("time limit, internal errors and a missing language", async () => {
  assert.deepEqual(await runOnJudge0(options(), "javascript", "// LOOP_FOREVER", "", { name: "a.js" }), { ok: false, stdout: "", stderr: "", timedOut: true });
  const broken = await runOnJudge0(options(), "javascript", "// BREAK_JUDGE0", "", { name: "a.js" });
  assert.match(broken.error ?? "", /isn't responding/);
  const noLang = await runOnJudge0(options({ languageIds: { python: 999 } }), "python", "print(1)", "", { name: "a.py" });
  assert.equal(noLang.ok, false);
});

test("a wrong token or an unreachable server is an error, never a run on this machine", async () => {
  const denied = await runOnJudge0(options({ authToken: "wrong" }), "javascript", "console.log(1)", "", { name: "a.js" });
  assert.match(denied.error ?? "", /refused/);
  const down = await runOnJudge0(options({ url: "http://127.0.0.1:9" }), "javascript", "console.log(1)", "", { name: "a.js" });
  assert.match(down.error ?? "", /isn't responding/);
  assert.match((await runOnJudge0(options({ url: "" }), "javascript", "1", "", { name: "a.js" })).error ?? "", /isn't set up/);
});

test("zip entries survive the round trip", () => {
  const entries = [{ name: "a.py", data: Buffer.from("print(1)\n") }, { name: "pkg/ü.txt", data: Buffer.from([0, 255, 10]) }];
  const back = unzip(zip(entries));
  assert.deepEqual(Object.keys(back), ["a.py", "pkg/ü.txt"]);
  assert.deepEqual(back["pkg/ü.txt"], Buffer.from([0, 255, 10]));
});
