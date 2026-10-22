import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ProgramRun = { ok: boolean; stdout: string; stderr: string; timedOut: boolean; error?: string };

/**
 * Student programs run on the server (Python, or JavaScript with this server's own Node), with a time limit and
 * a stripped-down environment so they can't read API keys or other secrets from it. On a public server, run the
 * whole app in a container as well.
 */
export function interpreterFor(language: string, pythonPath?: string): string {
  if (language === "javascript") return process.execPath;
  return pythonPath || (process.platform === "win32" ? "python" : "python3");
}

function safeEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG", "LC_ALL"];
  const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" };
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

/** Runs a whole program with the given stdin and returns what it actually printed. */
export async function runProgram(language: string, code: string, stdin: string, pythonPath?: string): Promise<ProgramRun> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibelearner-run-"));
  const file = path.join(dir, language === "javascript" ? "program.js" : "program.py");
  fs.writeFileSync(file, code, "utf8");
  try {
    return await runFile(language, file, stdin, pythonPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs a real project file from its own folder (so local imports work) and captures its output. */
export function runFile(language: string, filePath: string, stdin: string, pythonPath?: string): Promise<ProgramRun> {
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
