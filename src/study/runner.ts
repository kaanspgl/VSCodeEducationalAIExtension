import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { StudyTask, fnNameFor } from './tasks';

export type TestOutcome = {
  index: number;
  passed: boolean;
  args: unknown[];
  expected: unknown;
  actual?: unknown;
  error?: string;
};

export type TestReport = {
  ran: boolean;
  passed: number;
  total: number;
  allPassed: boolean;
  outcomes: TestOutcome[];
  /** Set when the code could not be run at all (syntax error, missing function, no interpreter). */
  fatal?: string;
};

const PY_HARNESS = `
import json, sys, os
src_path, cases_path, out_path, fn_name = sys.argv[1:5]
real_stdout = sys.stdout
sys.stdout = open(os.devnull, 'w')
result = {"fatal": None, "outcomes": []}
try:
    ns = {"__name__": "student_module"}
    with open(src_path, encoding="utf-8") as f:
        exec(compile(f.read(), "student_code", "exec"), ns)
    fn = ns.get(fn_name)
    if not callable(fn):
        result["fatal"] = "No function named " + fn_name + " was found."
    else:
        with open(cases_path, encoding="utf-8") as f:
            cases = json.load(f)
        for c in cases:
            try:
                result["outcomes"].append({"ok": True, "result": fn(*c["args"])})
            except Exception as e:
                result["outcomes"].append({"ok": False, "error": type(e).__name__ + ": " + str(e)})
except BaseException as e:
    result["fatal"] = type(e).__name__ + ": " + str(e)
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f)
`;

const JS_HARNESS = `
const fs = require('fs');
const [srcPath, casesPath, outPath, fnName] = process.argv.slice(2);
const result = { fatal: null, outcomes: [] };
const realWrite = process.stdout.write.bind(process.stdout);
console.log = () => {};
try {
  const src = fs.readFileSync(srcPath, 'utf8');
  const fn = new Function(src + '\\nreturn typeof ' + fnName + ' === "function" ? ' + fnName + ' : undefined;')();
  if (typeof fn !== 'function') {
    result.fatal = 'No function named ' + fnName + ' was found.';
  } else {
    const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
    for (const c of cases) {
      try { result.outcomes.push({ ok: true, result: fn(...c.args) }); }
      catch (e) { result.outcomes.push({ ok: false, error: String(e) }); }
    }
  }
} catch (e) {
  result.fatal = String(e);
}
fs.writeFileSync(outPath, JSON.stringify(result));
`;

export async function runTests(task: StudyTask, language: string, code: string): Promise<TestReport> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibelearner-'));
  const ext = language === 'javascript' ? 'js' : 'py';
  const srcPath = path.join(dir, `student.${ext}`);
  const harnessPath = path.join(dir, `harness.${ext}`);
  const casesPath = path.join(dir, 'cases.json');
  const outPath = path.join(dir, 'out.json');

  fs.writeFileSync(srcPath, code, 'utf8');
  fs.writeFileSync(harnessPath, language === 'javascript' ? JS_HARNESS : PY_HARNESS, 'utf8');
  fs.writeFileSync(casesPath, JSON.stringify(task.tests), 'utf8');

  const fnName = fnNameFor(task, language);
  const cfg = vscode.workspace.getConfiguration('vibelearner');

  let cmd: string;
  let env = process.env;
  if (language === 'javascript') {
    // Reuse VS Code's bundled Node so students don't need Node installed.
    cmd = process.execPath;
    env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  } else {
    cmd = cfg.get<string>('pythonPath') || (process.platform === 'win32' ? 'python' : 'python3');
  }

  try {
    await execFile(cmd, [harnessPath, srcPath, casesPath, outPath, fnName], env, 8000);
    if (!fs.existsSync(outPath)) {
      return fatalReport(task, 'The program did not finish (it may contain an infinite loop or wait for input).');
    }
    const raw = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (raw.fatal) return fatalReport(task, String(raw.fatal));

    const outcomes: TestOutcome[] = task.tests.map((t, i) => {
      const o = raw.outcomes[i];
      if (!o) return { index: i, passed: false, args: t.args, expected: t.expected, error: 'No result.' };
      if (!o.ok) return { index: i, passed: false, args: t.args, expected: t.expected, error: o.error };
      return { index: i, passed: deepEqual(o.result, t.expected), args: t.args, expected: t.expected, actual: o.result };
    });
    const passed = outcomes.filter(o => o.passed).length;
    return { ran: true, passed, total: outcomes.length, allPassed: passed === outcomes.length, outcomes };
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return fatalReport(task, `Could not find "${cmd}" to run ${language} code. Set vibelearner.pythonPath.`);
    }
    return fatalReport(task, err?.message || String(err));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fatalReport(task: StudyTask, fatal: string): TestReport {
  return { ran: false, passed: 0, total: task.tests.length, allPassed: false, outcomes: [], fatal };
}

function execFile(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    cp.execFile(cmd, args, { env, timeout: timeoutMs, windowsHide: true }, (err) => {
      // A non-zero exit still leaves out.json behind when the harness caught the failure itself.
      if (err && (err as any).code === 'ENOENT') return reject(err);
      resolve();
    });
  });
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type ProgramRun = { ok: boolean; stdout: string; stderr: string; timedOut: boolean; error?: string };

export function interpreterFor(language: string): { cmd: string; env: NodeJS.ProcessEnv } {
  if (language === 'javascript') return { cmd: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } };
  const cfg = vscode.workspace.getConfiguration('vibelearner');
  return { cmd: cfg.get<string>('pythonPath') || (process.platform === 'win32' ? 'python' : 'python3'), env: process.env };
}

/** Runs a whole program with the given stdin and returns what it actually printed. */
export async function runProgram(language: string, code: string, stdin: string): Promise<ProgramRun> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibelearner-run-'));
  const file = path.join(dir, language === 'javascript' ? 'program.js' : 'program.py');
  fs.writeFileSync(file, code, 'utf8');
  try {
    return await runFile(language, file, stdin);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs a real project file from its own folder (so local imports work) and captures its output. */
export function runFile(language: string, filePath: string, stdin: string): Promise<ProgramRun> {
  const { cmd, env } = interpreterFor(language);
  const cap = (s: string) => (s.length > 4000 ? s.slice(0, 4000) + '\n...(truncated)' : s);

  return new Promise((resolve) => {
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const done = (r: ProgramRun) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const child = cp.spawn(cmd, [filePath], { env, cwd: path.dirname(filePath), windowsHide: true });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 8000);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', (err: any) => {
      clearTimeout(timer);
      done({ ok: false, stdout: '', stderr: '', timedOut: false, error: err?.code === 'ENOENT' ? 'Could not find "' + cmd + '".' : String(err?.message || err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // Windows ships a "python" alias that only opens the Microsoft Store.
      if (language === 'python' && (code === 9009 || /Python was not found|Microsoft Store/i.test(stderr))) {
        return done({ ok: false, stdout: '', stderr: '', timedOut: false, error: 'Python is not installed (the "python" command only opens the Microsoft Store). Install it from python.org or set vibelearner.pythonPath.' });
      }
      done({ ok: code === 0 && !timedOut, stdout: cap(stdout), stderr: cap(stderr), timedOut });
    });
    child.stdin.on('error', () => { /* program ended before reading stdin */ });
    child.stdin.end(stdin);
  });
}

/** Student-facing summary. Shows inputs and expected values but never reveals reference code. */
export function formatReport(report: TestReport): string {
  if (!report.ran) return `⚠️ The code could not be run.\n${report.fatal ?? ''}`.trim();
  const head = report.allPassed
    ? `✅ All ${report.total} tests passed.`
    : `${report.passed} of ${report.total} tests passed.`;
  const failed = report.outcomes.filter(o => !o.passed).slice(0, 3).map(o => {
    const input = JSON.stringify(o.args.length === 1 ? o.args[0] : o.args);
    return o.error
      ? `• input ${input}: error — ${o.error}`
      : `• input ${input}: expected ${JSON.stringify(o.expected)}, got ${JSON.stringify(o.actual)}`;
  });
  return [head, ...failed].join('\n');
}
