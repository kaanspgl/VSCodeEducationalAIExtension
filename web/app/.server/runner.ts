import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Settings } from "./config";
import { judge0Language, runOnJudge0, type Judge0 } from "./judge0";

export type ProgramRun = { ok: boolean; stdout: string; stderr: string; timedOut: boolean; error?: string };

/** Where programs run: on this machine (with `pythonPath`, if set), or on a Judge0 server when `judge0Url` is set. */
export type RunTarget = { pythonPath?: string; judge0?: Judge0 };

export function runTargetFor(cfg: Settings): RunTarget {
  let url = String(cfg.get("judge0Url") ?? "").trim().replace(/\/+$/, "");
  // "localhost:2358" is meant as http://localhost:2358 (Judge0's own default).
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  const id = (key: string) => { const n = Number(cfg.get(key)); return Number.isInteger(n) && n > 0 ? n : undefined; };
  return {
    pythonPath: cfg.get<string>("pythonPath") || undefined,
    judge0: /^https?:\/\/\S+$/i.test(url)
      ? { url, token: String(cfg.get("judge0Token") ?? "").trim() || undefined, pythonId: id("judge0.pythonId"), javascriptId: id("judge0.javascriptId") }
      : undefined,
  };
}

/**
 * On Judge0, if it has the language. A Judge0 without Node.js runs JavaScript here instead (this server is Node);
 * one without Python 3 is an error, since the whole point is not needing Python on this machine.
 */
async function onJudge0(language: string, code: string, stdin: string, j: Judge0): Promise<ProgramRun | undefined> {
  const lang = language === "javascript" ? "javascript" : "python";
  let id: number | undefined;
  try {
    id = await judge0Language(j, lang);
  } catch (err: any) {
    // Judge0 answered with a refusal (e.g. a wrong token), or couldn't be reached at all.
    const msg = String(err?.message ?? err);
    return { ok: false, stdout: "", stderr: "", timedOut: false, error: msg.startsWith("Judge0") ? msg : `Couldn't reach Judge0 at ${j.url}: ${err?.cause?.code || msg}` };
  }
  if (id) return runOnJudge0(j, id, code, stdin);
  if (lang === "javascript") return undefined;
  return { ok: false, stdout: "", stderr: "", timedOut: false, error: `The Judge0 server at ${j.url} has no Python 3. Set judge0.pythonId to its Python language id.` };
}

/**
 * Student programs run on the server (Python, or JavaScript with this server's own Node), with a time limit and
 * a stripped-down environment so they can't read API keys or other secrets from it. On a public server, run the
 * whole app in a container as well.
 */
export function interpreterFor(language: string, pythonPath?: string): string {
  if (language === "javascript") return process.execPath;
  return pythonPath || (process.platform === "win32" ? windowsPython() : "python3");
}

let winPython: string | undefined;
/**
 * On Windows the first "python" on PATH is often the Microsoft Store alias, which only says "Python was not found"
 * even when Python is installed further down PATH. Prefer a real python.exe; fall back to "python" (right when the
 * Store version is the one installed). Not "py": the new Python install manager may download a runtime instead.
 */
function windowsPython(): string {
  if (winPython === undefined) {
    const dirs = (process.env.Path ?? process.env.PATH ?? "").split(";").filter((d) => d && !/\\WindowsApps\\?$/i.test(d));
    winPython = dirs.map((d) => path.join(d, "python.exe")).find((p) => fs.existsSync(p)) ?? "python";
  }
  return winPython;
}

function safeEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG", "LC_ALL"];
  const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" };
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

/** Runs a whole program with the given stdin and returns what it actually printed. */
export async function runProgram(language: string, code: string, stdin: string, target: RunTarget = {}): Promise<ProgramRun> {
  if (target.judge0) {
    const r = await onJudge0(language, code, stdin, target.judge0);
    if (r) return r;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibelearner-run-"));
  const file = path.join(dir, language === "javascript" ? "program.js" : "program.py");
  fs.writeFileSync(file, code, "utf8");
  try {
    return await runFile(language, file, stdin, { pythonPath: target.pythonPath });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs a real project file from its own folder (so local imports work) and captures its output. */
export async function runFile(language: string, filePath: string, stdin: string, target: RunTarget = {}): Promise<ProgramRun> {
  if (target.judge0) {
    const r = await onJudge0(language, fs.readFileSync(filePath, "utf8"), stdin, target.judge0);
    if (r) return r;
  }
  return runHere(language, filePath, stdin, target.pythonPath);
}

function runHere(language: string, filePath: string, stdin: string, pythonPath?: string): Promise<ProgramRun> {
  const cmd = interpreterFor(language, pythonPath);
  const cap = (s: string) => (s.length > 4000 ? s.slice(0, 4000) + "\n...(truncated)" : s);

  return new Promise((resolve) => {
    let stdout = "", stderr = "", timedOut = false, settled = false;
    const done = (r: ProgramRun) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const child = cp.spawn(cmd, [filePath], { env: safeEnv(), cwd: path.dirname(filePath), windowsHide: true });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 8000);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      done({ ok: false, stdout: "", stderr: "", timedOut: false, error: err?.code === "ENOENT" ? `Could not find "${cmd}" on the server.` : String(err?.message || err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // Windows ships a "python" alias that only opens the Microsoft Store.
      if (language === "python" && (code === 9009 || /Python was not found|Microsoft Store/i.test(stderr))) {
        return done({ ok: false, stdout: "", stderr: "", timedOut: false, error: "Python is not installed on the server. Install it, or set pythonPath in vibelearner.config.json." });
      }
      done({ ok: code === 0 && !timedOut, stdout: cap(stdout), stderr: cap(stderr), timedOut });
    });
    child.stdin.on("error", () => { /* program ended before reading stdin */ });
    child.stdin.end(stdin);
  });
}
