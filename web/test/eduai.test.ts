import assert from "node:assert/strict";
import { test } from "node:test";
import { EDUAI_DEFAULT_MODEL, EduAIError, eduaiComplete, fitMaxTokens } from "../app/.server/eduai.ts";

type Call = { url: string; headers: Record<string, string>; body: any };

/** A fake EduAI: answers each request with the next reply in the list, and records what was sent. */
function fakeEduAI(replies: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
  }) as unknown as typeof globalThis.fetch;
  const slept: number[] = [];
  const sleep = async (ms: number) => void slept.push(ms);
  return { calls, slept, deps: { fetch, sleep } };
}

const OK = { status: 200, body: { content: "ready", model: EDUAI_DEFAULT_MODEL, usage: { promptTokens: 20, completionTokens: 1, totalTokens: 21 }, finishReason: "stop" } };
const base = { apiKey: "test-key", model: EDUAI_DEFAULT_MODEL, system: "Be brief.", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 4096 };

test("sends the request the way EduAI's guide describes it", async () => {
  const f = fakeEduAI([OK]);
  const reply = await eduaiComplete({ ...base, temperature: 0, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] }, f.deps);
  assert.equal(reply.text, "ready");
  assert.equal(reply.usage?.totalTokens, 21);
  assert.equal(f.calls.length, 1);
  const { url, headers, body } = f.calls[0];
  assert.equal(url, "https://my.eduai.ok.ubc.ca/api/completion");
  assert.equal(headers["x-api-key"], "test-key");
  assert.deepEqual(body, {
    model: EDUAI_DEFAULT_MODEL,
    apiKeys: {},
    systemPrompt: "Be brief.",
    messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }],
    maxTokens: 4096,
    temperature: 0,
    streaming: false,
  });
});

test("refuses a missing key and a model that isn't a campus model, without sending anything", async () => {
  const f = fakeEduAI([OK]);
  await assert.rejects(eduaiComplete({ ...base, apiKey: "" }, f.deps), /API key missing/);
  await assert.rejects(eduaiComplete({ ...base, model: "gemini-2.5-flash" }, f.deps), /vllm:/);
  assert.equal(f.calls.length, 0);
});

test("lowers maxTokens to fit the context window, and refuses a prompt that can't fit", () => {
  assert.equal(fitMaxTokens("vllm:qwen3.5-9b-instruct", 3000, 4096), 4096);
  // 36,000 characters ≈ 12,300 tokens of the 9B's 16,384 (minus 10%): about 2,400 left for the answer.
  const fitted = fitMaxTokens("vllm:qwen3.5-9b-instruct", 36000, 4096);
  assert.ok(fitted > 1024 && fitted < 4096, String(fitted));
  assert.throws(() => fitMaxTokens("vllm:qwen3.5-2b-instruct", 45000, 4096), (e: any) => e instanceof EduAIError && /qwen3\.8-27b/.test(e.message));
  // The 27B has room for the same prompt.
  assert.equal(fitMaxTokens(EDUAI_DEFAULT_MODEL, 45000, 4096), 4096);
  // EduAI's cap for every model, and unknown models aren't checked.
  assert.equal(fitMaxTokens(EDUAI_DEFAULT_MODEL, 10, 50000), 16384);
  assert.equal(fitMaxTokens("vllm:some-new-model", 500000, 4096), 4096);
});

test("waits for Retry-After when EduAI is busy, then succeeds", async () => {
  const busy = { status: 503, body: { error: "busy", code: "API_ACCESS_BUSY" }, headers: { "Retry-After": "3" } };
  const f = fakeEduAI([busy, busy, OK]);
  const reply = await eduaiComplete(base, f.deps);
  assert.equal(reply.text, "ready");
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.slept, [3000, 3000]);
});

test("gives up on busy after 4 attempts", async () => {
  const f = fakeEduAI([{ status: 503, body: { code: "AI_ADMISSION_TIMEOUT" }, headers: { "Retry-After": "2" } }]);
  await assert.rejects(eduaiComplete(base, f.deps), /busy/);
  assert.equal(f.calls.length, 4);
});

test("doesn't make a participant wait hours for the daily limit", async () => {
  const f = fakeEduAI([{ status: 429, body: { error: "limit", code: "API_ACCESS_LIMIT", limit: "tokens" }, headers: { "Retry-After": "5400" } }]);
  await assert.rejects(eduaiComplete(base, f.deps), (e: any) => /daily tokens limit/.test(e.message) && /90 min/.test(e.message));
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.slept, []);
});

test("never retries a request that is wrong as sent", async () => {
  for (const [status, body, pattern] of [
    [400, { error: "too long", code: "CONTEXT_LENGTH_EXCEEDED" }, /too long/],
    [401, { error: "Unauthorized" }, /didn't accept the API key/],
    [403, { error: "not allowed", code: "API_ACCESS_MODEL_NOT_ALLOWED" }, /campus model/],
    [403, { error: "this account has no active API access" }, /no active API access/],
    [422, { error: "maxTokens must be at most 16384" }, /refused the request \(422\): maxTokens/],
  ] as const) {
    const f = fakeEduAI([{ status, body }]);
    await assert.rejects(eduaiComplete(base, f.deps), (e: any) => pattern.test(e.message) && e.status === status);
    assert.equal(f.calls.length, 1, `${status} was retried`);
  }
});

test("retries a server error marked retryable, and the key never appears in an error", async () => {
  const f = fakeEduAI([{ status: 500, body: { error: "model crashed", retryable: true } }, OK]);
  assert.equal((await eduaiComplete(base, f.deps)).text, "ready");
  assert.deepEqual(f.slept, [5000]);

  const g = fakeEduAI([{ status: 502, body: "<html>Bad gateway</html>" }]);
  await assert.rejects(eduaiComplete(base, g.deps), (e: any) => /EduAI Error \(502\)/.test(e.message) && !e.message.includes("test-key"));
});

test("sends at most maxConcurrent requests at once and queues the rest", async () => {
  let running = 0;
  let most = 0;
  const fetch = (async () => {
    most = Math.max(most, ++running);
    await new Promise((r) => setTimeout(r, 10));
    running--;
    return new Response(JSON.stringify(OK.body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const replies = await Promise.all(Array.from({ length: 7 }, () => eduaiComplete({ ...base, maxConcurrent: 2 }, { fetch })));
  assert.equal(replies.length, 7);
  assert.equal(most, 2);
});
