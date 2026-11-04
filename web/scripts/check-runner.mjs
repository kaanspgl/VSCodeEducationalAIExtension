// `npm run check:runner`: checks the Judge0 server the app will use, with the same settings the app gets
// (ecosystem.config.cjs's env when the file exists, then vibelearner.config.json and the environment).
// Runs a small Python and JavaScript program that import a helper file and read input, then checks that a
// crash names the student's file, that a program can't reach the network or see Judge0's config, and that an
// endless loop is stopped. Exits non-zero if anything fails.
// `-- --quick` runs only the first two (deploy.sh uses it).
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ecosystem = path.resolve("ecosystem.config.cjs");
if (fs.existsSync(ecosystem)) {
  const env = createRequire(import.meta.url)(ecosystem).apps?.[0]?.env ?? {};
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined && v !== "") process.env[k] = String(v);
}
const { loadSettings } = await import("../app/.server/config.ts");
const { judge0Languages, judge0Options, runOnJudge0 } = await import("../app/.server/judge0.ts");

const o = judge0Options(loadSettings());
if (!o) {
  console.log("No Judge0 configured (set JUDGE0_URL in ecosystem.config.cjs): student programs would run directly on this server.");
  process.exit(1);
}
console.log(`Judge0 at ${o.url}${o.authToken ? " (with auth token)" : " (no auth token)"}`);
const langs = await judge0Languages(o).catch((err) => {
  console.log(`✗ Can't list languages: ${err.message}`);
  process.exit(1);
});
console.log(`  Python:     ${langs.python ? `${langs.python.name}, id ${langs.python.id}` : "none found"}`);
console.log(`  JavaScript: ${langs.javascript ? `${langs.javascript.name}, id ${langs.javascript.id}` : "none found"}`);

const file = (name, text) => ({ name, data: Buffer.from(text) });
const checks = [
  {
    what: "Python with a local import and input",
    run: () => runOnJudge0(o, "python", "import sys, helper\nprint(helper.twice(int(sys.stdin.readline())), sys.version.split()[0])\n", "21\n", { name: "main.py", files: [file("helper.py", "def twice(x):\n    return 2 * x\n")] }),
    ok: (r) => r.ok && r.stdout.startsWith("42 "),
  },
  {
    what: "JavaScript with a local import and input",
    run: () => runOnJudge0(o, "javascript", 'const h = require("./helper");\nconsole.log(h.twice(Number(require("fs").readFileSync(0, "utf8"))), process.version);\n', "21\n", { name: "main.js", files: [file("helper.js", "exports.twice = (x) => 2 * x;\n")] }),
    ok: (r) => r.ok && r.stdout.startsWith("42 "),
  },
  {
    what: "Python crash shows the student's file name",
    run: () => runOnJudge0(o, "python", "print(1)\nundefined_name\n", "", { name: "main.py" }),
    ok: (r) => !r.ok && !r.error && /NameError/.test(r.stderr) && /main\.py/.test(r.stderr),
  },
  {
    what: "No network from inside the sandbox",
    run: () => runOnJudge0(o, "python", 'import socket\ntry:\n    socket.create_connection(("1.1.1.1", 443), 3)\n    print("CONNECTED")\nexcept OSError as e:\n    print("blocked:", e)\n', "", { name: "net.py" }),
    ok: (r) => !r.error && !r.stdout.includes("CONNECTED"),
  },
  {
    what: "Judge0's own config (passwords, token) isn't visible to programs",
    run: () => runOnJudge0(o, "python", 'import os\nprint(os.path.exists("/judge0.conf"), [k for k in os.environ if "TOKEN" in k or "PASS" in k])\n', "", { name: "peek.py" }),
    ok: (r) => r.ok && r.stdout.trim() === "False []",
  },
  {
    what: "An endless loop is stopped",
    run: () => runOnJudge0(o, "python", "while True:\n    pass\n", "", { name: "loop.py" }),
    ok: (r) => r.timedOut,
  },
];

let failures = 0;
for (const c of process.argv.includes("--quick") ? checks.slice(0, 2) : checks) {
  const r = await c.run();
  const pass = c.ok(r);
  if (!pass) failures++;
  const detail = r.error ? `error: ${r.error}` : `${r.stdout.trim().split("\n")[0] ?? ""}${r.stderr ? ` | ${r.stderr.trim().split("\n").pop()}` : ""}${r.timedOut ? " (timed out)" : ""}`;
  console.log(`${pass ? "✓" : "✗"} ${c.what}: ${detail.slice(0, 160)}`);
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nJudge0 is ready.");
process.exit(failures ? 1 : 0);
