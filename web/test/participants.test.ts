// `npm test`: participant codes, the order of the two parts, and moving from part to part.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-participants-"));
process.env.VL_DATA_DIR = dir;
const P = await import("../app/.server/participants.ts");
const { logEvent } = await import("../app/.server/logger.ts");
const R = await import("../app/.server/results.ts");

after(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => fs.rmSync(path.join(dir, "participants.json"), { force: true }));

test("codes are numbered on from the highest one, with 6-digit PINs that are stored only as hashes", () => {
  const first = P.createParticipants(3, "structured-first");
  assert.deepEqual(first.map((m) => m.code), ["P001", "P002", "P003"]);
  const more = P.createParticipants(2, "structured-first");
  assert.deepEqual(more.map((m) => m.code), ["P004", "P005"]);
  for (const m of [...first, ...more]) assert.match(m.pin, /^\d{6}$/);
  const stored = fs.readFileSync(path.join(dir, "participants.json"), "utf8");
  for (const m of first) assert.ok(!stored.includes(`"${m.pin}"`), "no PIN in the file");
  assert.ok(P.checkPin(P.findParticipant("p002"), first[1].pin));
});

test("order: structured first, regular first, or counterbalanced in shuffled pairs", () => {
  assert.ok(P.createParticipants(4, "structured-first").every((m) => m.order.join() === "guided,off"));
  assert.ok(P.createParticipants(4, "regular-first").every((m) => m.order.join() === "off,guided"));
  const cb = P.createParticipants(20, "counterbalanced");
  for (let i = 0; i < cb.length; i += 2) {
    assert.notEqual(cb[i].order.join(), cb[i + 1].order.join(), "each pair has one of each order");
  }
});

test("finishing a part moves on to the next condition, once, until both are done", () => {
  const [{ code }] = P.createParticipants(1, "regular-first");
  let p = P.findParticipant(code)!;
  assert.equal(p.part, 1);
  assert.equal(P.conditionFor(p), "off");
  P.markPartStarted(code, 1);
  p = P.finishPart(code, 1)!;
  assert.equal(p.part, 2);
  assert.equal(P.conditionFor(p), "guided");
  assert.ok(p.parts[0].startedAt && p.parts[0].finishedAt);
  assert.equal(P.finishPart(code, 1)!.part, 2, "a second click on part 1's button doesn't skip part 2");
  assert.equal(P.finishPart(code, 2)!.part, 3);
  assert.equal(P.conditionFor(P.findParticipant(code)!), undefined);
  P.setPart(code, 2);
  p = P.findParticipant(code)!;
  assert.equal(p.part, 2, "the admin can put them back on a part");
  assert.equal(p.parts[1].finishedAt, undefined);
});

test("consent is recorded the first time only", () => {
  const [{ code }] = P.createParticipants(1, "structured-first");
  assert.equal(P.recordConsent(code, "Version 2"), true);
  const at = P.findParticipant(code)!.consent!.at;
  assert.equal(P.recordConsent(code, "Version 3"), false);
  assert.deepEqual(P.findParticipant(code)!.consent, { at, version: "Version 2" });
});

test("the admin summary counts each part from the log", async () => {
  const [{ code }] = P.createParticipants(1, "structured-first");
  await logEvent(code, "consent", { agreed: true, version: "Version 2" });
  const line = (part: number, type: string, data: Record<string, unknown>, llmMs?: number) =>
    JSON.stringify({ ts: new Date().toISOString(), participant: code, condition: "vibe", part, type, data, llmMs }) + "\n";
  fs.appendFileSync(path.join(dir, "study_logs", `${code}.jsonl`), [
    line(1, "vibe_request", { text: "make a grade calculator" }),
    line(1, "vibe_reply", { text: "here", changes: [{}] }, 4000),
    line(1, "vibe_change", { status: "accepted", path: "grades.py" }),
    line(1, "vibe_learn", { kind: "predict_answer", correct: true }),
    line(1, "vibe_learn", { kind: "predict_answer", correct: false }),
    line(1, "vibe_quiz_response", { correct: true }),
    line(1, "vibe_quiz_response", { skippedAt: 0 }),
    line(1, "vibe_learn", { kind: "challenge_start", id: "c1" }),
    line(1, "vibe_learn", { kind: "challenge_check", id: "c1", done: false }),
    line(1, "vibe_learn", { kind: "challenge_check", id: "c1", done: true }),
    line(2, "vibe_request", { text: "a times table" }),
    line(2, "vibe_change", { status: "rejected", path: "t.py" }),
    "{ cut short",
  ].join(""));
  const [one, two] = R.summarize(P.findParticipant(code)!, R.readLog(code));
  assert.equal(one.condition, "Structured");
  assert.deepEqual(
    [one.requests, one.accepted, one.predictRight, one.predictTotal, one.quizRight, one.quizTotal, one.challengesDone, one.challengesGiven, one.aiSeconds],
    [1, 1, 1, 2, 1, 1, 1, 1, 4],
  );
  assert.equal(two.condition, "Regular");
  assert.deepEqual([two.requests, two.accepted, two.rejected], [1, 0, 1]);
  const csv = R.summaryCsv([P.findParticipant(code)!]).trim().split("\n");
  assert.equal(csv.length, 3, "a header and one row per part");
  assert.ok(csv[1].startsWith(`${code},Structured then Regular,`));
  assert.ok(!R.participantsCsv([P.findParticipant(code)!]).includes("pin"), "no PIN fields in the downloads");
  assert.equal(R.describe({ ts: "", participant: code, type: "vibe_request", data: { text: "make a grade calculator" } }), "Asked: make a grade calculator");
});
