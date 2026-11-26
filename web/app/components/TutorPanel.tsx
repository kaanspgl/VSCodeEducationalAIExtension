import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { action, post } from "~/lib/api";
import { currentExchange, flowSteps, nowCard, pendingChanges } from "~/lib/flow";
import { md } from "~/lib/md";
import type { VibeView } from "~/lib/types";
import { Icon } from "./Icon";
import { Changes, Message } from "./Messages";

/**
 * Right column: working with the AI. In Structured mode a thin track shows the three steps and the parts of the
 * current one; under it one card shows only what is happening now (the heading, the AI's latest messages, the
 * walkthrough stop, the question, code waiting to be accepted), and the message box sits right under the card.
 * Everything said earlier is in the history. Regular mode gets the same card and box, without the track or the
 * heading.
 */
export function TutorPanel({ view }: { view: VibeView }) {
  const now = nowCard(view);
  const guided = view.level === "guided" && view.stage === "chat";
  const { you, replies, earlier } = currentExchange(view);
  // Code still waiting to be accepted or rejected stays in the card even after the exchange it came with.
  const inReplies = new Set(replies.flatMap((m) => m.changes?.map((c) => c.id) ?? []));
  const waiting = pendingChanges(view).filter((c) => !inReplies.has(c.id));
  // One primary action at a time: while the walkthrough or a question is open, that box has it, not Accept.
  const boxOpen = !!(view.tour || view.quiz);
  const acceptMsg = boxOpen ? undefined : [...replies].reverse().find((m) => m.changes?.some((c) => c.status === "pending"))?.id;
  const chips = view.level === "light";

  // The newest thing in the card is at the bottom: keep it in sight.
  const bodyRef = useRef<HTMLDivElement>(null);
  const last = view.messages[view.messages.length - 1];
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const toEnd = () => { el.scrollTop = el.scrollHeight; };
    toEnd();
    // Again once the page has its final layout (after loading, the card's height settles a moment later).
    const r = requestAnimationFrame(toEnd);
    const t = window.setTimeout(toEnd, 200);
    return () => { cancelAnimationFrame(r); window.clearTimeout(t); };
  }, [view.messages.length, last?.text, last?.buttons?.length, view.busy, view.tour?.index, view.quiz?.index, view.study?.task]);

  return (
    <aside className="tutorcol" aria-label="Working with the AI">
      {guided && <StepTrack view={view} />}
      <div ref={bodyRef} className="card" aria-live="polite">
        {now && (
          <div className={`nowhead ${now.busy ? "busy" : ""} ${now.done ? "done" : ""}`}>
            {now.busy ? <span className="spin" aria-hidden /> : now.done ? <Icon name="check" size={15} /> : null}
            <div>
              <h2>{now.title}</h2>
              {now.text && <p>{now.text}</p>}
            </div>
          </div>
        )}
        {view.plan && <PlanBox view={view} />}
        {earlier.length > 0 && (
          <details className="earlier">
            <summary><span className="chev" aria-hidden><Icon name="chevron" size={11} /></span>Explaining and reading the code · {earlier.length} message{earlier.length === 1 ? "" : "s"}</summary>
            <div className="exchange">
              {earlier.map((m) => m.role === "student"
                ? <div key={m.id} className="you"><span className="eyebrow">You</span><div dangerouslySetInnerHTML={{ __html: md(m.text) }} /></div>
                : <Message key={m.id} m={m} busy={view.busy} primaryAccept={false} chips={chips} />)}
            </div>
          </details>
        )}
        {you && (
          <div className="you">
            <span className="eyebrow">You</span>
            <div dangerouslySetInnerHTML={{ __html: md(you.text) }} />
          </div>
        )}
        <div className="exchange">
          {replies.map((m) => <Message key={m.id} m={m} busy={view.busy} primaryAccept={m.id === acceptMsg} chips={chips} />)}
        </div>
        {waiting.length > 0 && (
          <div className="waiting">
            <span className="eyebrow">Code waiting for you</span>
            <Changes changes={waiting} busy={view.busy} primaryAccept={!boxOpen && !acceptMsg} chips={chips} />
          </div>
        )}
        {view.tour && <TourBox view={view} />}
        {view.quiz && <QuizBox view={view} />}
        {view.busy && !now?.busy && <div className="thinking" role="status"><span className="spin" aria-hidden />{view.busyLabel || "Working…"}</div>}
        {!you && !replies.length && !view.busy && !view.tour && <p className="hint empty">Nothing here yet for this question.</p>}
      </div>
      <Composer view={view} />
    </aside>
  );
}

/** The three steps in a thin track, and under it the parts of the step happening now. */
function StepTrack({ view }: { view: VibeView }) {
  const steps = flowSteps(view);
  const cur = steps.find((s) => s.status === "now");
  return (
    <nav className="track" aria-label="Steps">
      <ol className="trackbar">
        {steps.map((s) => (
          <li key={s.n} className={s.status} aria-current={s.status === "now" ? "step" : undefined}>
            <span className="tnum" aria-hidden>{s.status === "done" ? <Icon name="check" size={10} /> : s.n}</span>
            <span className="tlabel"><span className="sr-only">{s.status === "done" ? "Done: " : s.status === "now" ? "Now: " : "Later: "}</span>{s.label}</span>
          </li>
        ))}
      </ol>
      {cur && cur.subs.length > 0 && (
        <ol className="tsubs" aria-label={`Parts of step ${cur.n}`}>
          {cur.subs.map((x) => (
            <li key={x.key} className={x.status}>
              <span className="vdot" aria-hidden>{x.status === "done" ? "✓" : x.status === "skipped" ? "–" : ""}</span>
              {x.label}{x.detail && <span className="vdetail">{x.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}

/** A walkthrough stop, right beside the lines it highlights in the code. */
function TourBox({ view }: { view: VibeView }) {
  const t = view.tour!;
  return (
    <section className="tourbox" aria-label="Walkthrough">
      <div className="quiz-head">
        <span className="eyebrow grow">Part {t.index + 1} of {t.total} · {t.start === t.end ? `line ${t.start}` : `lines ${t.start}–${t.end}`}</span>
        <button className="linkbtn" disabled={view.busy} onClick={() => action("tourEnd")}>Exit</button>
      </div>
      <div className="tourprog" aria-hidden>
        {Array.from({ length: t.total }, (_, i) => <span key={i} className={i <= t.index ? "on" : ""} />)}
      </div>
      <h3 className="tour-title">{t.title}</h3>
      <div className="tourtext" dangerouslySetInnerHTML={{ __html: md(t.text) }} />
      <div className="cactions">
        <button className="btn secondary sm" disabled={view.busy || t.index === 0} onClick={() => action("tourPrev")}>◀ Back</button>
        {t.index + 1 < t.total
          ? <button className="btn sm" disabled={view.busy} onClick={() => action("tourNext")}>Next ▶</button>
          : <button className="btn sm" disabled={view.busy} onClick={() => action("tourEnd")}>Finish walkthrough</button>}
      </div>
    </section>
  );
}

function QuizBox({ view }: { view: VibeView }) {
  const q = view.quiz!;
  return (
    <section className="quizbox" aria-label="Question">
      <div className="quiz-head">
        <span className="eyebrow grow">{q.label} · {q.index + 1} of {q.total}</span>
        <button className="linkbtn" disabled={view.busy} onClick={() => action("skipQuiz")}>Skip</button>
      </div>
      <div className="stem" dangerouslySetInnerHTML={{ __html: md(q.stem) }} />
      <div className="choices">
        {q.choices.map((c, i) => (
          <button key={i} className="choice" disabled={view.busy} onClick={() => post({ type: "quizAnswer", choice: i })}><span className="letter">{"ABCD"[i]}</span><span>{c}</span></button>
        ))}
      </div>
    </section>
  );
}

/** A big build split into steps (outside a study). */
function PlanBox({ view }: { view: VibeView }) {
  const plan = view.plan!;
  return (
    <section className="planbox" aria-label="Plan">
      <div className="quiz-head">
        <div className="grow"><div className="eyebrow">📋 Plan</div><div className="goal">{plan.goal}</div></div>
        <button className="linkbtn" disabled={view.busy} onClick={() => action("dropPlan")} title="Stop following this plan">Close</button>
      </div>
      <ol className="plansteps">
        {plan.steps.map((s, i) => (
          <li key={i} className={s.status}><span className="mark" aria-hidden>{s.status === "done" ? "✓" : s.status === "doing" ? "▶" : "○"}</span> {s.title}</li>
        ))}
      </ol>
      {plan.next && (
        <div className="cactions">
          <button className="btn sm" disabled={view.busy} onClick={() => action("buildNext")}>Build step {plan.next.index + 1}: {plan.next.title}</button>
          {plan.remaining > 1 && <button className="btn secondary sm" disabled={view.busy} onClick={() => action("buildAll")}>Build the rest at once</button>}
        </div>
      )}
    </section>
  );
}

/**
 * The message box, right under the card. When what the student types IS their explanation or prediction, the box
 * says so and its button names it; otherwise it is the same plain box in both modes.
 */
function Composer({ view }: { view: VibeView }) {
  const [text, setText] = useState("");
  const [projectName, setProjectName] = useState<string | undefined>();
  // A failed send hands the message back so it isn't lost.
  useEffect(() => { if (view.draft) setText(view.draft.text); }, [view.draft?.id]);

  // What was pasted into the box since the last send. Only what is still in the message counts, so a paste that
  // was deleted again doesn't mark a request typed in the participant's own words.
  const pastes = useRef<string[]>([]);
  // In a study (study.blockPaste) nothing can be pasted or dropped in: requests are scored for how completely the
  // participant describes the program, and the task text already names its input and output.
  const [pasteRefused, setPasteRefused] = useState(false);
  const takeText = (e: { preventDefault(): void }, pasted: string) => {
    if (!view.ui.noPaste) { if (pasted) pastes.current.push(pasted); return; }
    e.preventDefault();
    setPasteRefused(true);
    action("pasteBlocked", String(pasted.length));
  };
  const send = () => {
    const t = text.trim();
    if (!t || !view.inputEnabled) return;
    const pasted = pastes.current.map((p) => p.trim()).filter((p) => p && t.includes(p)).reduce((n, p) => n + p.length, 0);
    pastes.current = [];
    setPasteRefused(false);
    setText("");
    post({ type: "send", text: t, target: view.target, ...(pasted ? { pasted: Math.min(pasted, t.length) } : {}) });
  };

  const answer = view.awaiting === "gate" ? "explanation" : view.awaiting === "predict" ? "prediction" : undefined;
  const label = view.quiz ? "Answer the question above first"
    : view.busy ? view.busyLabel || "Working…"
    : answer === "explanation" ? "Your explanation: it answers the AI's question"
    : answer === "prediction" ? "Your prediction: what will it print?"
    : view.tour ? "Ask about this part of the code"
    : "Message to the AI";
  const sendLabel = answer === "explanation" ? "Send explanation" : answer === "prediction" ? "Predict & run" : "Send";
  const study = view.study?.step === "work";
  const ctx = view.ctx;

  return (
    <div className={`composer ${answer && view.inputEnabled ? "answer" : ""}`}>
      <label htmlFor="vl-message" className="clabel">{label}</label>
      <textarea id="vl-message" value={text} disabled={!view.inputEnabled} placeholder={view.placeholder} rows={answer ? 3 : 2}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => takeText(e, e.clipboardData.getData("text"))}
        onDrop={(e) => takeText(e, e.dataTransfer.getData("text"))}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
      <div className="composer-row">
        <span className="seechip" title="What the AI can see when you send a message">
          <Icon name="folder" size={12} /> {ctx.files} file{ctx.files === 1 ? "" : "s"}{ctx.active ? ` · ${ctx.active}` : ""}{ctx.selection ? <> · <b>{ctx.selection}</b></> : null}
        </span>
        <label className="targetpick" title="Where should new code go?">Code goes in
          <select value={view.target} disabled={view.busy} onChange={(e) => action("setTarget", e.target.value)} aria-label="Code goes in">
            <option value="auto">Auto</option>
            <option value="new">A new file</option>
            {view.targets.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        {!study && (projectName === undefined ? (
          <button className="btn ghost sm" disabled={view.busy} onClick={() => setProjectName("my-project")} title="Start a new program in its own folder"><Icon name="plus" size={12} /> Project</button>
        ) : (
          <form className="inline" onSubmit={(e) => { e.preventDefault(); action("newProject", projectName.trim()); setProjectName(undefined); }}>
            <input type="text" autoFocus value={projectName} maxLength={40} pattern="[\w\-]{1,40}" title="Letters, numbers, - or _ (no spaces)"
              onChange={(e) => setProjectName(e.target.value)} aria-label="Project name" />
            <button className="btn sm" type="submit" disabled={view.busy || !/^[\w-]{1,40}$/.test(projectName.trim())}>Create</button>
            <button className="linkbtn" type="button" onClick={() => setProjectName(undefined)}>Cancel</button>
          </form>
        ))}
        <div className="grow" />
        <button className={`btn ${boxIsOpen(view) ? "secondary" : ""}`} disabled={!view.inputEnabled || !text.trim()} onClick={send}>{sendLabel} <span aria-hidden>↵</span></button>
      </div>
      {pasteRefused && view.ui.noPaste && <span className="hint pastenote" role="status">Pasting is turned off here. Describe what you want in your own words.</span>}
    </div>
  );
}

const boxIsOpen = (view: VibeView) => !!(view.tour || view.quiz);
