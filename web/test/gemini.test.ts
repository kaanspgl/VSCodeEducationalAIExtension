import assert from "node:assert/strict";
import { test } from "node:test";
import { GEMINI_DEFAULT_MODEL, geminiComplete } from "../app/.server/gemini.ts";

type Reply = { status: number; body?: unknown } | { throws: string };

/** A fake Gemini API: answers each request with the next reply in the list, and records what was sent. */
function fakeGemini(replies: Reply[]) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if ("throws" in r) throw Object.assign(new Error("aborted"), { name: r.throws });
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), { status: r.status });
  }) as unknown as typeof globalThis.fetch;
  const slept: number[] = [];
  const sleep = async (ms: number) => void slept.push(ms);
  return { calls, slept, deps: { fetch, sleep } };
}

const answer = (parts: unknown[], finishReason = "STOP") => ({ status: 200, body: { candidates: [{ content: { role: "model", parts }, finishReason }] } });
const OK = answer([{ text: "ready" }]);
const base = { apiKey: "test-key", model: GEMINI_DEFAULT_MODEL, system: "Be brief.", messages: [{ role: "user" as const, content: "hi" }] };
const busy = { status: 503, body: { error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } } };

test("sends the system prompt, the conversation and the temperature the way the Gemini API expects", async () => {
  const f = fakeGemini([OK]);
  const text = await geminiComplete({ ...base, temperature: 0, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] }, f.deps);
  assert.equal(text, "ready");
  const { url, headers, body } = f.calls[0];
  assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`);
  assert.equal(headers["x-goog-api-key"], "test-key");
  assert.deepEqual(body, {
    contents: [
      { role: "user", parts: [{ text: "a" }] },
      { role: "model", parts: [{ text: "b" }] },
      { role: "user", parts: [{ text: "c" }] },
    ],
    generationConfig: { temperature: 0 },
    systemInstruction: { role: "system", parts: [{ text: "Be brief." }] },
  });
});

test("joins the answer's text parts and leaves out thoughts", async () => {
  const f = fakeGemini([answer([{ text: "planning…", thought: true }, { text: "print(", thoughtSignature: "x" }, { text: "1)" }])]);
  assert.equal(await geminiComplete(base, f.deps), "print(1)");
});

test("a missing key is refused without sending anything", async () => {
  const f = fakeGemini([OK]);
  await assert.rejects(geminiComplete({ ...base, apiKey: "" }, f.deps), /API key missing/);
  assert.equal(f.calls.length, 0);
});

test("busy answers and time-outs are retried, then the answer comes through", async () => {
  const f = fakeGemini([busy, { throws: "TimeoutError" }, OK]);
  assert.equal(await geminiComplete(base, f.deps), "ready");
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.slept, [3000, 6000]);
});

test("a per-minute limit waits as long as Google suggests", async () => {
  const limited = { status: 429, body: { error: { code: 429, message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 15 per minute", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "11.4s" }] } } };
  const f = fakeGemini([limited, OK]);
  assert.equal(await geminiComplete(base, f.deps), "ready");
  assert.deepEqual(f.slept, [12000]);
});

test("a used-up daily limit is not retried, and says when it resets", async () => {
  const daily = { status: 429, body: { error: { code: 429, message: "Quota exceeded for quota metric 'Generate Content API requests per day'", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } } };
  const f = fakeGemini([daily, OK]);
  await assert.rejects(geminiComplete(base, f.deps), /daily limit .* midnight Pacific/);
  assert.equal(f.calls.length, 1);
});

test("a model that stays busy gives up after four attempts with what to do", async () => {
  const f = fakeGemini([busy]);
  await assert.rejects(geminiComplete(base, f.deps), /busy right now \(503\).*gemini\.model/);
  assert.equal(f.calls.length, 4);
});

test("a retired model names the setting to change and isn't retried", async () => {
  const gone = { status: 404, body: { error: { code: 404, message: "This model models/gemini-2.5-flash is no longer available to new users.", status: "NOT_FOUND" } } };
  const f = fakeGemini([gone]);
  await assert.rejects(geminiComplete({ ...base, model: "gemini-2.5-flash" }, f.deps), /no model "gemini-2\.5-flash".*GEMINI_MODEL/);
  assert.equal(f.calls.length, 1);
});

test("a wrong key says so", async () => {
  const bad = { status: 400, body: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } } };
  await assert.rejects(geminiComplete(base, fakeGemini([bad]).deps), /didn't accept the Gemini API key/);
});

test("a blocked answer is an error, not an empty reply", async () => {
  const f = fakeGemini([{ status: 200, body: { candidates: [{ finishReason: "SAFETY" }] } }]);
  await assert.rejects(geminiComplete(base, f.deps), /no answer \(SAFETY\)/);
  assert.equal(await geminiComplete(base, fakeGemini([answer([])]).deps), "");
});
