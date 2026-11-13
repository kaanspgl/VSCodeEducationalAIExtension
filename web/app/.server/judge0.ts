import type { ProgramRun } from "./runner";

/**
 * Running student programs on a Judge0 server (https://judge0.com) instead of this machine's own Python and Node:
 * set `judge0Url` (e.g. a self-hosted Judge0 at http://127.0.0.1:2358). Judge0 runs each program in its own sandbox.
 * Each program is sent as one file, so a program that imports another file of the project can't run there.
 */
export type Judge0 = {
  url: string;
  /** Judge0's AUTHN_TOKEN, if the server has one (sent as X-Auth-Token). */
  token?: string;
  /** Language ids, if not the newest Python 3 / Node.js the server lists (ids differ between Judge0 versions). */
  pythonId?: number;
  javascriptId?: number;
};

const CPU_SECONDS = 5;
/** The same limit as a program run on this machine. */
const WALL_SECONDS = 8;
/** How long to wait for Judge0 to take a program off its queue and run it. */
const DEADLINE_MS = 30_000;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: unknown) => (typeof s === "string" && s ? Buffer.from(s, "base64").toString("utf8") : "");
const cap = (s: string) => (s.length > 4000 ? s.slice(0, 4000) + "\n...(truncated)" : s);
const failed = (error: string): ProgramRun => ({ ok: false, stdout: "", stderr: "", timedOut: false, error });

async function call(j: Judge0, path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(j.url + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(j.token ? { "X-Auth-Token": j.token } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { error: text.slice(0, 300) }; }
  return { status: res.status, json };
}

const newer = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** The newest Python 3 and Node.js each Judge0 server offers, looked up once per server. */
const langs = new Map<string, Promise<{ python?: number; javascript?: number }>>();
function languages(j: Judge0) {
  let p = langs.get(j.url);
  if (!p) {
    p = call(j, "/languages").then(({ status, json }) => {
      if (status !== 200 || !Array.isArray(json)) throw new Error(refusal(status, json));
      const newest = (re: RegExp): number | undefined => {
        const found: { id: number; v: string }[] = [];
        for (const l of json) {
          const v = re.exec(String(l?.name ?? ""))?.[1];
          if (v && Number(l?.id) > 0) found.push({ id: Number(l.id), v });
        }
        return found.sort((a, b) => newer(b.v, a.v))[0]?.id;
      };
      return { python: newest(/^Python \((3(?:\.\d+)*)\)$/), javascript: newest(/^JavaScript \(Node\.js (\d+(?:\.\d+)*)\)$/) };
    });
    langs.set(j.url, p);
    p.catch(() => langs.delete(j.url)); // try again next time
  }
  return p;
}

function refusal(status: number, json: any): string {
  if (status === 401 || status === 403) return `Judge0 refused the request (${status}): check judge0Token.`;
  return `Judge0 answered ${status}: ${String(json?.error ?? json?.message ?? JSON.stringify(json)).slice(0, 200)}`;
}

/** Judge0's language id for this language, or undefined if the server has none (unless one is set). */
export async function judge0Language(j: Judge0, language: "python" | "javascript"): Promise<number | undefined> {
  const set = language === "python" ? j.pythonId : j.javascriptId;
  return set ?? (await languages(j))[language];
}

/** Runs one program on Judge0 and returns what it printed, in the same shape as a run on this machine. */
export async function runOnJudge0(j: Judge0, languageId: number, code: string, stdin: string): Promise<ProgramRun> {
  try {
    const body = JSON.stringify({
      source_code: b64(code), language_id: languageId, stdin: b64(stdin),
      cpu_time_limit: CPU_SECONDS, wall_time_limit: WALL_SECONDS,
    });
    let r = await call(j, "/submissions?base64_encoded=true&wait=true", { method: "POST", body });
    // Some Judge0 servers don't let a request wait for the result: then ask for it until it's ready.
    if (r.status === 400 && /wait/i.test(JSON.stringify(r.json))) r = await call(j, "/submissions?base64_encoded=true&wait=false", { method: "POST", body });
    if (r.status >= 400) return failed(refusal(r.status, r.json));
    let sub = r.json;
    const token = String(sub?.token ?? "");
    const deadline = Date.now() + DEADLINE_MS;
    while (!(Number(sub?.status?.id) > 2)) {
      if (!token) return failed(`Judge0 sent back no result: ${JSON.stringify(sub).slice(0, 200)}`);
      if (Date.now() > deadline) return failed("Judge0 didn't run the program in time (its queue may be full).");
      await new Promise((res) => setTimeout(res, 250));
      r = await call(j, `/submissions/${encodeURIComponent(token)}?base64_encoded=true&fields=stdout,stderr,compile_output,message,status`);
      if (r.status >= 400) return failed(refusal(r.status, r.json));
      sub = r.json;
    }
    return fromSubmission(sub);
  } catch (err: any) {
    return failed(`Couldn't reach Judge0 at ${j.url}: ${err?.cause?.code || err?.message || err}`);
  }
}

/** Judge0's statuses: 3 accepted, 5 time limit, 6 compilation error, 7-12 runtime errors, 13 internal error, 14 exec format error. */
function fromSubmission(sub: any): ProgramRun {
  const id = Number(sub.status.id);
  const stdout = cap(unb64(sub.stdout));
  // The same as a run on this machine: what the program wrote to stderr (a Python traceback), nothing made up.
  const stderr = cap(unb64(sub.stderr) || (id === 6 ? unb64(sub.compile_output) : ""));
  if (id === 13 || id === 14) return failed(`Judge0 couldn't run it: ${sub.status.description ?? "internal error"}${sub.message ? ` (${unb64(sub.message)})` : ""}`);
  if (id === 5) return { ok: false, stdout, stderr, timedOut: true };
  return { ok: id === 3, stdout, stderr, timedOut: false };
}
