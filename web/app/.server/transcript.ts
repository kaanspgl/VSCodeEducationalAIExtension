import { readLog } from "./admin";

/**
 * A participant's log read back as the conversation they had: what they typed, what the AI said, and what happened
 * in between (steps started, skipped or not possible and why, changes accepted, programs run). For the researcher
 * page, so the log can be read without opening the raw JSONL.
 */
export type TranscriptItem = {
  ts: string;
  /** "student" and "tutor" are what was said; "event" is something that happened; "divider" starts a session, part or question. */
  kind: "student" | "tutor" | "event" | "divider";
  /** Markdown, as the participant saw it where that is logged. */
  text: string;
  /** Short labels: where in the flow it happened, or how something was decided. */
  tags?: string[];
  tone?: "ok" | "warn" | "bad";
  /** The study part and question it belongs to (e.g. "part1:q2"), when there is a plan. */
  task?: string;
};

const STAGE: Record<string, string> = { tour: "Walkthrough", predict: "Predict & run", check: "Question", challenge: "Modify" };
const MODE: Record<string, string> = { "vibe:guided": "structured", "vibe:off": "regular", "vibe:light": "light" };
const L = (i: number) => "ABCD"[i] ?? "?";
const fence = (s: string) => `\`\`\`\n${String(s).replace(/`{3,}/g, "``")}\n\`\`\``;

export async function transcript(code: string): Promise<TranscriptItem[] | undefined> {
  const log = await readLog(code);
  if (log === undefined) return undefined;
  const out: TranscriptItem[] = [];
  /** The question each answer was to, by change and position. */
  const questions = new Map<string, { choices: string[] }>();
  let lastEdit: { path: string; t: number; item: TranscriptItem; n: number } | undefined;

  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    const d = e.data ?? {};
    const ts = String(e.ts ?? "");
    // Tags may be left out with a falsy entry (`cond && "tag"`).
    const add = (kind: TranscriptItem["kind"], text: string, extra: Omit<Partial<TranscriptItem>, "tags"> & { tags?: unknown[] } = {}) => {
      const tags = extra.tags?.filter((t): t is string => typeof t === "string" && !!t);
      out.push({ ts, kind, text, task: e.taskId, ...extra, tags: tags?.length ? tags : undefined });
    };
    if (!(e.type === "vibe_learn" && d.kind === "student_edit")) lastEdit = undefined;

    switch (e.type) {
      case "consent": add("event", `Consent given (form version ${d.consentVersion ?? "?"}).`); break;
      case "vibe_session":
        add("divider", [d.part ? `Part ${d.part}${d.concept ? ` · ${d.concept}` : ""}` : "Session", `${d.condition ?? MODE[e.condition] ?? ""} mode`, d.continued ? "continued" : "", `model ${d.model ?? "?"}`].filter(Boolean).join(" · "));
        break;
      case "study_step":
        if (d.kind === "question_shown") add("divider", `Question ${d.question}: ${d.text ?? ""}`);
        else if (d.kind === "part_finished") {
          add("divider", `Finished part ${d.part} on question ${d.onQuestion} of ${d.of}${typeof d.seconds === "number" ? ` after ${Math.round(d.seconds / 60)} min` : ""}${d.overTime ? " (over the suggested time)" : ""}`);
        } else if (/_quiz_shown$/.test(d.kind)) add("event", `Shown the quiz ${d.kind.startsWith("pre") ? "before" : "after"} part ${d.part}.`);
        else if (/_quiz_done$/.test(d.kind)) add("event", `Said the quiz ${d.kind.startsWith("pre") ? "before" : "after"} part ${d.part} was done.`);
        else if (d.kind === "signed_out") add("event", "Signed out.");
        break;
      case "vibe_request":
        add("student", String(d.text ?? ""), {
          tags: [
            d.duringChallenge && "during Modify",
            d.inTour && "during the walkthrough",
            d.source === "explain_error" && "Explain this error button",
            d.source === "explain_selection" && "Explain selection button",
          ],
        });
        break;
      case "vibe_gate":
        if (d.kind === "idea_check" && d.reply) add("tutor", String(d.reply), { tags: ["Step 1: explain the idea", d.verdict && `verdict: ${d.verdict}`], tone: d.verdict === "enough" ? "ok" : undefined });
        else if (d.kind === "idea_answer") add("student", String(d.text ?? ""), { tags: ["Step 1"] });
        else if (d.kind === "steps_answer") add("student", String(d.text ?? ""), { tags: ["Steps"] });
        else if (d.kind === "steps_check" && d.reply) add("tutor", String(d.reply), { tags: ["Steps", d.verdict && `verdict: ${d.verdict}`] });
        else if (d.kind === "done") add("event", `Idea explained ${d.scaffolded?.idea || d.scaffolded?.steps ? "with the tutor filling in what was missing" : "unaided"}.`, { tone: d.scaffolded?.idea ? "warn" : "ok" });
        else if (d.kind === "skipped") add("event", "Skipped explaining the idea (Skip: just write the code).", { tone: "warn" });
        break;
      case "vibe_reply": {
        const changes = Array.isArray(d.changes) ? d.changes : [];
        add("tutor", String(d.text ?? "") || "(no text)", {
          tags: [
            ...changes.map((c: any) => `${c.path} +${c.added ?? 0} −${c.removed ?? 0}${c.isNew ? " (new file)" : ""}${c.status === "failed" ? " (couldn't apply)" : ""}`),
            d.answerOnly && "answered without changing code",
            d.droppedBlocks && `${d.droppedBlocks} code change${d.droppedBlocks > 1 ? "s" : ""} left out`,
          ],
        });
        break;
      }
      case "vibe_change":
        if (d.status === "accepted") add("event", `Accepted the change to \`${d.path}\` ${d.reviewedBeforeAccept ? `after ${d.toured ? "the walkthrough" : "viewing the diff"}` : "without looking at the code first"}.`, { tone: "ok" });
        else if (d.status === "rejected") add("event", `Rejected the change to \`${d.path}\`.`, { tone: "warn" });
        else if (d.status === "viewed_diff") add("event", `Viewed the diff of \`${d.path}\`.`);
        else if (d.status === "stale" || d.status === "path_is_folder") add("event", `The change to \`${d.path}\` couldn't be applied (${d.status === "stale" ? "the file had changed" : "it's a folder"}).`, { tone: "bad" });
        break;
      case "vibe_learn":
        switch (d.kind) {
          case "tour_start": add("event", `Walkthrough started (${d.stops} stops).`); break;
          case "tour_end": add("event", `Walkthrough ${d.status === "done" ? "finished" : "left"} at stop ${d.reachedStop} of ${d.of}.`, { tone: d.status === "done" ? "ok" : "warn" }); break;
          case "predict_start": add("tutor", "🔮 **Predict:** what will the program print?", { tags: ["Predict & run"] }); break;
          case "predict_answer":
            add("student", String(d.prediction ?? ""), { tags: ["Predict & run"] });
            add("tutor", `${d.correct ? "✅" : "🔍"} ${d.feedback ?? ""}\n\n**What it actually printed:**\n${fence(d.actual ?? "")}`, { tags: [d.correct ? "prediction right" : "prediction wrong"], tone: d.correct ? "ok" : undefined });
            break;
          case "stage":
            if (d.status === "na") add("event", `${STAGE[d.stage] ?? d.stage} couldn't be done${d.reason ? `: ${String(d.reason).replace(/\.+$/, "")}` : " (no reason logged)"}.`, { tone: "bad" });
            else if (d.status === "skipped") add("event", `${STAGE[d.stage] ?? d.stage} skipped${d.stage === "tour" ? " (left before the second stop)" : " by the participant"}.`, { tone: "warn" });
            break;
          case "question_check":
            if (d.verdict !== "verified") add("event", `A question's answer key was ${d.verdict} after running the changed program (it prints ${d.actual}).`);
            break;
          case "challenge_start": add("tutor", `🛠 **Modify, your turn:** ${d.task}`, { tags: ["Modify"] }); break;
          case "challenge_hint": add("tutor", `💡 ${d.hint ?? "(hint shown)"}`, { tags: ["Hint"] }); break;
          case "challenge_check":
            add("tutor", d.feedback ? `${d.done ? "🎉" : "🔍"} ${d.feedback}` : `${d.done ? "🎉 Done." : "🔍 Not done yet."}${d.output ? `\n\nIt printed:\n${fence(d.output)}` : ""}`, {
              tags: ["Check my work", `decided by ${d.decidedBy === "run" ? "running it" : "the model"}`, d.via === "ai" && "made with the AI's help"],
              tone: d.done ? "ok" : undefined,
            });
            break;
          case "challenge_skip": add("event", "Skipped the Modify challenge.", { tone: "warn" }); break;
          case "steps_done": add("event", "All three steps done for this program.", { tone: "ok" }); break;
          case "student_edit": {
            const t = Date.parse(ts);
            if (lastEdit && lastEdit.path === d.path && t - lastEdit.t < 30_000) {
              lastEdit.n++;
              lastEdit.t = t;
              lastEdit.item.text = `Edited \`${d.path}\` in the editor (${lastEdit.n} saves).`;
            } else {
              add("event", `Edited \`${d.path}\` in the editor.`, { tags: [d.duringChallenge && "for Modify"] });
              lastEdit = { path: String(d.path), t, item: out[out.length - 1], n: 1 };
            }
            break;
          }
        }
        break;
      case "vibe_quiz_question": {
        const choices: string[] = Array.isArray(d.choices) ? d.choices.map(String) : [];
        questions.set(`${d.changeId ?? d.kind}:${d.index}`, { choices });
        add("tutor", `🔍 **Question:** ${d.stem ?? ""}\n\n${choices.map((c, i) => `- ${L(i)}. ${c}${i === d.correctIndex ? " ✓" : ""}`).join("\n")}`, { tags: [d.kind === "project" ? "Quiz me on my program" : "Question"] });
        break;
      }
      case "vibe_quiz_response":
        if (typeof d.chosen === "number") {
          const q = questions.get(`${d.changeId ?? d.kind}:${d.index}`);
          add("student", `${L(d.chosen)}. ${q?.choices[d.chosen] ?? ""}`, { tags: [d.correct ? "right" : "wrong"], tone: d.correct ? "ok" : "warn" });
        } else add("event", "Skipped the question.", { tone: "warn" });
        break;
      case "program_run":
        add("event", `▶ Ran \`${d.file}\`${d.stdin ? " with input" : ""}.${d.error ? ` Couldn't run it: ${d.error}` : d.timedOut ? " It didn't finish in time." : ""}\n${!d.error && !d.timedOut ? fence(`${String(d.stdout ?? "").trimEnd() || "(nothing printed)"}${d.stderr ? `\n${String(d.stderr).trim()}` : ""}`) : ""}`, { tone: d.error || d.stderr ? "bad" : undefined });
        break;
      case "vibe_error": add("event", `Error: ${d.message ?? ""}`, { tone: "bad" }); break;
      case "vibe_plan":
        if (Array.isArray(d.steps)) add("tutor", `📋 Plan: ${d.goal ?? ""}\n\n${d.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}`);
        break;
    }
  }
  return out;
}
