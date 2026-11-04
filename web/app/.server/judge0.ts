import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import type { Settings } from "./config";
import type { ProgramRun } from "./runner";

/**
 * Runs student programs on a Judge0 server (https://judge0.com) instead of on this one. Every run gets its own
 * sandbox with no network, and only the files of that student's project go in, so a program can't read the
 * app's API keys or other participants' data. Configured with judge0.url (or JUDGE0_URL); see DEPLOY.md.
 *
 * Uses only Node built-ins and erasable TypeScript, so scripts/check-runner.mjs and the tests can import it directly.
 */

export type Judge0Options = {
  url: string;
  authHeader: string;
  authToken: string;
  /** Override the language ids picked from GET /languages (needed only for Judge0 flavors with other names). */
  languageIds: { python?: number; javascript?: number };
};

export type ZipEntry = { name: string; data: Buffer };

type Lang = { id: number; name: string; sourceFile: string };
type Langs = { python?: Lang; javascript?: Lang };
type Result = {
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  status?: { id: number; description: string };
};

/** Same limits as running on this server: 8 seconds, output capped at 4000 characters. */
const TIME_LIMIT_S = 8;
const MAX_OUTPUT = 4000;
/** How long to wait for Judge0 overall, including time in its queue. */
const DEADLINE_MS = 60_000;
/** What goes along with a program so its local imports and data files work. Judge0 extracts at most 10 MB. */
const FILE_LIMITS = { maxFiles: 300, maxFileBytes: 1_000_000, maxTotalBytes: 5_000_000 };
const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", ".vscode", ".idea", "coverage"]);

/** Judge0 settings, or undefined when programs should run on this server (runner = "local", or no judge0.url). */
export function judge0Options(cfg: Settings): Judge0Options | undefined {
  const runner = String(cfg.get("runner") ?? "").trim().toLowerCase();
  const url = String(cfg.get("judge0.url") ?? "").trim().replace(/\/+$/, "");
  if (runner === "local" || (!url && runner !== "judge0")) return undefined;
  const id = (k: string) => {
    const n = Number(cfg.get(k));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  return {
    url,
    authHeader: String(cfg.get("judge0.authHeader") || "X-Auth-Token"),
    authToken: String(cfg.get("judge0.authToken") ?? ""),
    languageIds: { python: id("judge0.pythonLanguageId"), javascript: id("judge0.javascriptLanguageId") },
  };
}

class Judge0Error extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, what: string) {
    super(`${what} -> HTTP ${status} ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(o: Judge0Options, method: "GET" | "POST", pathname: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (o.authToken) headers[o.authHeader] = o.authToken;
  let res: Response;
  try {
    res = await fetch(o.url + pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    throw new Error(`${method} ${o.url}${pathname.split("?")[0]} failed: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Judge0Error(res.status, text, `${method} ${pathname.split("?")[0]}`);
  return JSON.parse(text) as T;
}

const versionOf = (v: string) => v.split(".").map((n) => Number(n) || 0);
const newer = (a: string, b: string) => {
  const x = versionOf(a), y = versionOf(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** Newest "Python (3.x)" and "JavaScript (Node.js x)" on the server, with the file name Judge0 gives the source. */
async function detectLanguages(o: Judge0Options): Promise<Langs> {
  const list = await request<{ id: number; name: string }[]>(o, "GET", "/languages");
  const pick = (re: RegExp, override?: number) => {
    if (override) return list.find((l) => l.id === override) ?? { id: override, name: `language ${override}` };
    let best: { id: number; name: string; v: string } | undefined;
    for (const l of list) {
      const m = re.exec(l.name);
      if (m && (!best || newer(m[1], best.v))) best = { ...l, v: m[1] };
    }
    return best;
  };
  const withFile = async (l: { id: number; name: string } | undefined, fallback: string): Promise<Lang | undefined> => {
    if (!l) return undefined;
    const info = await request<{ source_file?: string }>(o, "GET", `/languages/${l.id}`).catch(() => ({ source_file: undefined }));
    return { id: l.id, name: l.name, sourceFile: info.source_file || fallback };
  };
  return {
    python: await withFile(pick(/^Python \((3[\d.]*)\)$/, o.languageIds.python), "script.py"),
    javascript: await withFile(pick(/^JavaScript \(Node\.js ([\d.]+)\)$/, o.languageIds.javascript), "script.js"),
  };
}

const langCache = new Map<string, Promise<Langs>>();
/** Looked up once per server (and again after a failure). */
export function judge0Languages(o: Judge0Options): Promise<Langs> {
  const key = `${o.url} ${o.languageIds.python ?? ""} ${o.languageIds.javascript ?? ""}`;
  let p = langCache.get(key);
  if (!p) {
    p = detectLanguages(o);
    langCache.set(key, p);
    p.catch(() => langCache.delete(key));
  }
  return p;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s?: string | null) => (s ? Buffer.from(s, "base64").toString("utf8") : "");
const cap = (s: string) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n...(truncated)" : s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failed = (error: string): ProgramRun => ({ ok: false, stdout: "", stderr: "", timedOut: false, error });

/** What participants see when the runner itself fails; the details go to the server log (pm2 logs). */
function explain(err: unknown): string {
  console.error(`[judge0] ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Judge0Error) {
    if (err.status === 503) return "the code runner is busy right now. Try again in a moment.";
    if (err.status === 401 || err.status === 403) return "the code runner refused the request (check judge0.authToken on the server).";
  }
  return "the code runner isn't responding right now. Please tell the researcher.";
}

/**
 * Runs `code` on Judge0 and returns what it printed, in the same shape as a local run. `name` is the file name the
 * student knows (Judge0 calls the source script.py/script.js, so that name is swapped back in the output);
 * `files` go into the sandbox next to it.
 */
export async function runOnJudge0(o: Judge0Options, language: string, code: string, stdin: string, opts: { name: string; files?: ZipEntry[] }): Promise<ProgramRun> {
  if (!o.url) return failed("the code runner isn't set up (runner is \"judge0\" but judge0.url is empty).");
  let found: Lang | undefined;
  try {
    const langs = await judge0Languages(o);
    found = language === "javascript" ? langs.javascript : langs.python;
  } catch (err) {
    return failed(explain(err));
  }
  const lang = found;
  if (!lang) {
    return failed(`the code runner has no ${language === "javascript" ? "JavaScript (Node.js)" : "Python 3"} language. Set judge0.${language === "javascript" ? "javascript" : "python"}LanguageId in vibelearner.config.json.`);
  }
  const files = (opts.files ?? []).filter((f) => f.name !== lang.sourceFile);

  let result: Result;
  try {
    const { token } = await request<{ token: string }>(o, "POST", "/submissions?base64_encoded=true&wait=false", {
      language_id: lang.id,
      source_code: b64(code),
      stdin: b64(stdin),
      cpu_time_limit: TIME_LIMIT_S,
      wall_time_limit: TIME_LIMIT_S,
      enable_network: false,
      ...(files.length ? { additional_files: zip(files).toString("base64") } : {}),
    });
    // Poll rather than wait=true, which Judge0 recommends against and some servers turn off.
    const deadline = Date.now() + DEADLINE_MS;
    // A run takes about a second end to end; polling a local server every 250 ms costs nothing.
    for (let delay = 150; ; delay = 250) {
      await sleep(delay);
      result = await request<Result>(o, "GET", `/submissions/${encodeURIComponent(token)}?base64_encoded=true&fields=stdout,stderr,compile_output,message,status`);
      if ((result.status?.id ?? 0) > 2) break;
      if (Date.now() > deadline) return failed(explain(new Error(`submission ${token} still queued after ${DEADLINE_MS / 1000}s`)));
    }
  } catch (err) {
    return failed(explain(err));
  }

  const source = lang.sourceFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rename = (s: string) => s.replace(new RegExp(`(?:/box/)?\\b${source}\\b`, "g"), () => opts.name);
  const status = result.status!;
  // 3 Accepted, 5 Time Limit Exceeded, 6 Compilation Error, 7-12 Runtime Error, 13 Internal Error, 14 Exec Format Error
  if (status.id === 13 || status.id === 14) return failed(explain(new Error(`${status.description}: ${unb64(result.message)}`)));
  let stderr = unb64(result.stderr) || unb64(result.compile_output);
  // Killed with nothing on stderr (e.g. over the memory limit): say so instead of looking like a silent success.
  if (!stderr.trim() && status.id >= 7 && status.id <= 12) stderr = `${status.description}${result.message ? `: ${unb64(result.message)}` : ""}`;
  return { ok: status.id === 3, stdout: cap(rename(unb64(result.stdout))), stderr: cap(rename(stderr)), timedOut: status.id === 5 };
}

/**
 * The files next to a program (what its folder holds when it runs here), for local imports and data files.
 * Skips dependency/cache folders and symlinks, and stops at FILE_LIMITS.
 */
export async function collectFiles(dir: string): Promise<ZipEntry[]> {
  const out: ZipEntry[] = [];
  let total = 0;
  const walk = async (abs: string, rel: string) => {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= FILE_LIMITS.maxFiles) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full, r);
      } else if (e.isFile()) {
        const st = await fs.stat(full).catch(() => undefined);
        if (!st || st.size > FILE_LIMITS.maxFileBytes || total + st.size > FILE_LIMITS.maxTotalBytes) continue;
        out.push({ name: r, data: await fs.readFile(full) });
        total += st.size;
      }
    }
  };
  await walk(dir, "");
  return out;
}

/** A minimal .zip (stored, no compression), which is what Judge0 takes as additional_files. */
export function zip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = zlib.crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time 00:00
    local.writeUInt16LE(0x21, 12); // date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, e.data);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(0x0314, 4); // made by Unix, 2.0 (so the mode below is used)
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(e.data.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(0o100644 * 0x10000, 38); // regular file, rw-r--r--
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + e.data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
