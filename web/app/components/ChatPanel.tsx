import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { action, post } from "~/lib/api";
import { md } from "~/lib/md";
import type { VibeChange, VibeMsg, VibeView } from "~/lib/types";
import { Icon } from "./Icon";
import { LEVELS, STAGE_ICON } from "./levels";

/** The VibeLearner panel: the same chat, change cards, walkthrough, quiz and progress as the extension's webview. */
export function ChatPanel({ view }: { view: VibeView }) {
  const busy = view.busy;
  const logRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [text, setText] = useState("");
  const [projectName, setProjectName] = useState<string | undefined>();
  // Scrolled well up from the newest message: offer a way back down.
  const [farUp, setFarUp] = useState(false);

  // A failed send hands the message back so it isn't lost.
  useEffect(() => { if (view.draft) setText(view.draft.text); }, [view.draft?.id]);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && atBottom.current) log.scrollTop = log.scrollHeight;
  }, [view.messages.length, view.busy, view.messages[view.messages.length - 1]?.text]);

  const send = () => {
    const t = text.trim();
    if (!t || !view.inputEnabled) return;
    setText("");
    atBottom.current = true;
    post({ type: "send", text: t, target: view.target });
  };

  const learn = view.level !== "off";
  const ctx = view.ctx;
  // One primary action at a time: while a walkthrough or question is open, that box has it, not Accept or Send.
  const boxOpen = !!(view.tour || view.quiz);
  const acceptMsg = boxOpen ? undefined : [...view.messages].reverse().find((m) => m.changes?.some((c) => c.status === "pending"))?.id;
  return (
    // Pressing any button (Accept, Next, an answer…) means "show me what happens next": follow the log down.
    <section className="panel" onClickCapture={(e) => { if ((e.target as HTMLElement).closest("button")) atBottom.current = true; }}>
      <header className="topbar">
        <span className="brand"><span className="brandmark" aria-hidden>V</span><span className="brandtext">VibeLearner</span></span>
        {view.project && (
          <span className="badge projchip" title="Working only inside this folder">
            <Icon name="folder" size={12} /> {view.project}/ <button className="chipx" disabled={busy} onClick={() => action("leaveProject")} title="Leave project (see all your files)" aria-label={`Leave project ${view.project}`}>✕</button>
          </span>
        )}
        <span className="badge ctxchip" title="What VibeLearner can see">
          <Icon name="folder" size={12} /> {ctx.files} file{ctx.files === 1 ? "" : "s"}{ctx.active ? ` · ${ctx.active}` : ""}{ctx.selection ? <> · <b>{ctx.selection}</b></> : null}
        </span>
        <div className="grow" />
        {view.logging && <span className="badge logbadge" title="Signed in for the study: this session is recorded under this code"><span className="pulse" aria-hidden>●</span> {view.participant}</span>}
        {/* In a research session the mode isn't named: participants aren't told which version they are using. */}
        {view.ui.mode && (
          <label className="levelpick" title="Structured or regular vibe coding">Mode
            <select value={view.level} disabled={view.levelLocked || busy} onChange={(e) => action("setLevel", e.target.value)}>
              {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
            </select>
          </label>
        )}
        <SignOut view={view} />
      </header>

      {learn && view.ui.progress && <Progress view={view} />}

      <main className="main">
        <StudyBar view={view} />
        <StructuredBar view={view} />
        {view.plan && (
          <section className="planbox" aria-label="Plan">
            <div className="quiz-head">
              <div className="grow"><div className="boxlabel">📋 Plan</div><div className="goal">{view.plan.goal}</div></div>
              <button className="linkbtn" disabled={busy} onClick={() => action("dropPlan")} title="Stop following this plan">Close</button>
            </div>
            <ol className="plansteps">
              {view.plan.steps.map((s, i) => (
                <li key={i} className={s.status}><span className="mark" aria-hidden>{s.status === "done" ? "✓" : s.status === "doing" ? "▶" : "○"}</span> {s.title}</li>
              ))}
            </ol>
            {view.plan.next && (
              <div className="cactions">
                <button className="btn sm" disabled={busy} onClick={() => action("buildNext")}>Build step {view.plan.next.index + 1}: {view.plan.next.title}</button>
                {view.plan.remaining > 1 && <button className="btn secondary sm" disabled={busy} onClick={() => action("buildAll")}>Build the rest at once</button>}
              </div>
            )}
          </section>
        )}

        <div className="logwrap">
        <div ref={logRef} className="scroll" role="log" aria-live="polite" aria-label="Conversation"
          onScroll={(e) => {
            const l = e.currentTarget;
            const gap = l.scrollHeight - l.scrollTop - l.clientHeight;
            atBottom.current = gap < 40;
            setFarUp(gap > 240);
          }}>
          {view.messages.map((m) => <Message key={m.id} m={m} busy={busy} primaryAccept={m.id === acceptMsg} />)}
          {busy && <div className="thinking" role="status"><span className="spin" aria-hidden />{view.busyLabel || "Working…"}</div>}
        </div>
        {farUp && (
          <button className="jump" onClick={() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" })}>
            <Icon name="down" size={13} /> Jump to latest
          </button>
        )}
        </div>

        {view.tour && (
          <section className="tourbox" aria-label="Walkthrough">
            <div className="quiz-head">
              <span className="hint">🧭 Walkthrough · stop {view.tour.index + 1} of {view.tour.total} · <code>{view.tour.path}</code> line{view.tour.start === view.tour.end ? ` ${view.tour.start}` : `s ${view.tour.start}–${view.tour.end}`}{view.tour.pending ? " (proposed)" : ""}</span>
              <button className="linkbtn" disabled={busy} onClick={() => action("tourEnd")}>Exit</button>
            </div>
            <div className="tourprog" aria-hidden>
              {Array.from({ length: view.tour.total }, (_, i) => <span key={i} className={i <= view.tour!.index ? "on" : ""} />)}
            </div>
            <h3 className="tour-title">{view.tour.title}</h3>
            <div dangerouslySetInnerHTML={{ __html: md(view.tour.text) }} />
            <div className="cactions">
              <button className="btn secondary sm" disabled={busy || view.tour.index === 0} onClick={() => action("tourPrev")}>◀ Back</button>
              {view.tour.index + 1 < view.tour.total
                ? <button className="btn sm" disabled={busy} onClick={() => action("tourNext")}>Next ▶</button>
                : <button className="btn sm" disabled={busy} onClick={() => action("tourEnd")}>Finish walkthrough</button>}
              <span className="hint"><span className="swatch" aria-hidden />The highlighted lines are in the editor.</span>
            </div>
          </section>
        )}

        {view.quiz && (
          <section className="quizbox" aria-label="Question">
            <div className="quiz-head"><span className="hint">🔍 {view.quiz.label} · question {view.quiz.index + 1} of {view.quiz.total}</span><button className="linkbtn" disabled={busy} onClick={() => action("skipQuiz")}>Skip</button></div>
            <div className="stem" dangerouslySetInnerHTML={{ __html: md(view.quiz.stem) }} />
            <div className="choices">
              {view.quiz.choices.map((c, i) => (
                <button key={i} className="choice" disabled={busy} onClick={() => post({ type: "quizAnswer", choice: i })}><span className="letter">{"ABCD"[i]}</span><span>{c}</span></button>
              ))}
            </div>
          </section>
        )}

        <div className="composer">
          <div className="actions">
            <label className="targetpick" title="Where should new code go?">Code goes in
              <select value={view.target} disabled={busy} onChange={(e) => action("setTarget", e.target.value)}>
                <option value="auto">Auto (VibeLearner decides)</option>
                <option value="new">A new file</option>
                {view.targets.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            {projectName === undefined ? (
              <button className="btn ghost sm" disabled={busy} onClick={() => setProjectName("my-project")} title="Start a new program in its own folder"><Icon name="plus" size={12} /> New project</button>
            ) : (
              <form className="inline" onSubmit={(e) => { e.preventDefault(); action("newProject", projectName.trim()); setProjectName(undefined); }}>
                <input type="text" autoFocus value={projectName} maxLength={40} pattern="[\w\-]{1,40}" title="Letters, numbers, - or _ (no spaces)"
                  onChange={(e) => setProjectName(e.target.value)} aria-label="Project name" />
                <button className="btn sm" type="submit" disabled={busy || !/^[\w-]{1,40}$/.test(projectName.trim())}>Create</button>
                <button className="linkbtn" type="button" onClick={() => setProjectName(undefined)}>Cancel</button>
              </form>
            )}
            <div className="grow" />
            <button className="btn ghost sm" disabled={!ctx.selection || !view.inputEnabled} onClick={() => action("explainSelection")} title="Select code in the editor first">Explain selection</button>
          </div>
          <div className="composer-row">
            <textarea value={text} disabled={!view.inputEnabled} placeholder={view.placeholder} aria-label="Message to VibeLearner"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className={`btn ${boxOpen ? "secondary" : ""}`} disabled={!view.inputEnabled || !text.trim()} onClick={send}><Icon name="send" size={15} /> Send</button>
          </div>
          <span className="hint">Enter to send · Shift+Enter for a new line</span>
        </div>
      </main>
    </section>
  );
}

/** Signs this browser out, so the next person starts from the start screen. A participant's place in the study is kept. */
function SignOut({ view }: { view: VibeView }) {
  const ask = view.logging
    ? `Sign out ${view.participant}? Your place in the study is saved: sign in with the same code to carry on.`
    : "Leave this session and go back to the start screen? Your files stay on the server, but this conversation is cleared.";
  return (
    <button className="btn ghost sm signout" title={view.logging ? "Sign out" : "Back to the start screen"}
      onClick={() => { if (confirm(ask)) post({ type: "reset" }); }}>
      <Icon name="exit" size={13} /><span className="sr-only">{view.logging ? "Sign out" : "Back to the start screen"}</span>
    </button>
  );
}

/** Seconds since the participant started this part's questions, ticking; undefined until the browser has the time. */
function useElapsed(started: number | undefined): number | undefined {
  const [now, setNow] = useState<number | undefined>(undefined);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now === undefined || started === undefined ? undefined : Math.max(0, Math.floor((now - started) / 1000));
}

/** The study plan's current question, with the way to the next one and to the end of the part. */
function StudyBar({ view }: { view: VibeView }) {
  const st = view.study;
  const secs = useElapsed(st?.started);
  if (!st || st.step !== "work") return null;
  const last = st.task >= st.tasks.length - 1;
  // Time spent against the suggested time. Nothing is cut off when it runs out.
  const over = st.minutes > 0 && secs !== undefined && secs >= st.minutes * 60;
  return (
    <section className="studybar" aria-label="Study question">
      <div className="quiz-head">
        <span className="boxlabel grow">Part {st.part + 1} of {st.parts} · {st.concept} · Question {st.task + 1} of {st.tasks.length}</span>
        {st.minutes > 0 && secs !== undefined && (
          <span className={`studyclock ${over ? "over" : ""}`} role="timer" aria-label="Time on this part">
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} of {st.minutes} min{over ? " · time is up: finish what you're doing, then finish the part" : ""}
          </span>
        )}
      </div>
      <div className="studytask">{st.tasks[st.task]}</div>
      <div className="cactions">
        <button className="btn secondary sm" disabled={view.busy || st.task === 0} onClick={() => action("studyPrev")}>◀ Previous</button>
        {!last && <button className={`btn ${over ? "secondary" : ""} sm`} disabled={view.busy} onClick={() => action("studyNext")}>Next question ▶</button>}
        <div className="grow" />
        {/* Always there: when time is up a participant finishes from wherever they are, without paging through the rest. */}
        <button className={`btn ${last || over ? "" : "ghost"} sm`} disabled={view.busy}
          onClick={() => { if (confirm(`Finish part ${st.part + 1}? You can't come back to it afterwards.`)) action("studyFinish"); }}>
          Finish part {st.part + 1}
        </button>
      </div>
    </section>
  );
}

function StructuredBar({ view }: { view: VibeView }) {
  const st = view.structured;
  if (!st) return null;
  return (
    <ol className="stepbar" aria-label="Steps for this request">
      {st.labels.map((label, i) => {
        const n = i + 1;
        const state = n < st.step ? "done" : n === st.step ? "now" : "next";
        return (
          <li key={n} className={`sb ${state}`} aria-current={state === "now" ? "step" : undefined}>
            <span className="num" aria-hidden>{state === "done" ? "✓" : n}</span>
            <span>
              <span className="sr-only">{state === "done" ? "Done: " : state === "now" ? "Now: " : "Next: "}</span>
              {label}
              {state === "now" && st.sub && <span className="sub">{st.sub}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Progress({ view }: { view: VibeView }) {
  const [open, setOpen] = useState(false);
  const any = view.skills.some((s) => s.value !== "—") || view.concepts.length > 0;
  return (
    <details className="progress" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><span className="chev" aria-hidden><Icon name="chevron" size={12} /></span><Icon name="chart" /> Your progress{any ? "" : <span className="muted"> (builds up as you go)</span>}</summary>
      <div className="skills">
        {view.skills.map((s) => <div key={s.label} className="skill" title={s.detail}><span>{s.label}</span><b>{s.value}</b></div>)}
      </div>
      {view.concepts.length > 0 && (
        <>
          <div className="hint" style={{ marginTop: 8 }}>Concepts you've worked with</div>
          <div className="chips">
            {view.concepts.map((c) => (
              <span key={c.name} className="cchip" title={`in ${c.seen} change(s)${c.total ? `, ${c.right}/${c.total} questions right` : ""}`}>
                {c.name}{c.total ? <> <span className={c.right === c.total ? "ok" : c.right ? "muted" : "warn"}>{c.right}/{c.total}</span></> : null}
              </span>
            ))}
          </div>
        </>
      )}
      <div className="cactions"><button className="btn secondary sm" disabled={!view.inputEnabled} onClick={() => action("quizProject")}>Quiz me on my program</button></div>
    </details>
  );
}

function Message({ m, busy, primaryAccept }: { m: VibeMsg; busy: boolean; primaryAccept: boolean }) {
  const who = m.role === "student" ? "You: " : m.role === "tutor" ? "VibeLearner: " : "";
  return (
    <div className={`msg ${m.role}`}>
      {m.role === "tutor" && <span className="avatar" aria-hidden>V</span>}
      <div className={`bubble ${m.look ?? ""}`} role={m.look === "crash" ? "alert" : undefined}>
        {who && <span className="sr-only">{who}</span>}
        {m.score && <strong className="bigscore" aria-hidden>{m.score}</strong>}
        <div dangerouslySetInnerHTML={{ __html: md(m.text) }} />
        {m.changes && <Changes changes={m.changes} busy={busy} primaryAccept={primaryAccept} />}
        {m.buttons && (
          <div className="cactions">
            {m.buttons.map((b, i) => (
              <button key={i} className={`btn ${b.primary ? "" : "secondary"} sm`} disabled={busy} onClick={() => action(b.cmd, b.arg)}>{b.label}</button>
            ))}
          </div>
        )}
        {m.tip && (
          <details className="tip">
            <summary><span className="chev" aria-hidden><Icon name="chevron" size={12} /></span>💡 Prompt tip <span className="muted">({m.tip.score}/6)</span></summary>
            <div dangerouslySetInnerHTML={{ __html: md(m.tip.text) }} />
            {m.tip.improved && <><div className="hint" style={{ marginTop: 4 }}>A stronger version:</div><div className="improved">{m.tip.improved}</div></>}
          </details>
        )}
      </div>
    </div>
  );
}

const STATE_TEXT: Record<string, string> = { active: "now", done: "✓", skipped: "skipped", na: "—" };

function Changes({ changes, busy, primaryAccept }: { changes: VibeChange[]; busy: boolean; primaryAccept: boolean }) {
  const pending = changes.filter((c) => c.status === "pending");
  // With several pending changes, "Accept all" is the primary action rather than each Accept.
  const acceptCls = primaryAccept && pending.length === 1 ? "btn sm" : "btn secondary sm";
  return (
    <div className="changes">
      {changes.map((c) => (
        <div key={c.id}>
          <div className={`change ${c.status}`}>
            <div className="cfile">
              <code>{c.path}</code>{c.isNew && <span className="tag">new file</span>}
              {c.status !== "failed" && <span className="diffstat"><span className="plus">+{c.added}</span> <span className="minus">−{c.removed}</span></span>}
              <span className="cbtns">
                {c.status === "pending" ? (
                  <>
                    <button className="btn ghost sm" disabled={busy} onClick={() => action("viewDiff", c.id)}>View diff</button>
                    <button className="btn danger sm" disabled={busy} onClick={() => action("reject", c.id)}>Reject</button>
                    <button className={acceptCls} disabled={busy} onClick={() => action("accept", c.id)}>Accept</button>
                  </>
                ) : c.status === "accepted" ? <span className="status ok">✓ Applied</span>
                  : c.status === "rejected" ? <span className="status muted">Rejected</span>
                  : <span className="status warn">Couldn't apply</span>}
              </span>
            </div>
            {c.note && <div className="muted small">{c.note}</div>}
          {c.learn && (
            <div className="learnrow" aria-label={`Learning steps for ${c.path}`}>
              {c.learn.map((s) => {
                const needsAccept = s.stage !== "tour" && c.status !== "accepted";
                const disabled = busy || s.status === "done" || s.status === "na" || s.status === "active" || needsAccept;
                const title = s.status === "na" ? "Not available for this change" : needsAccept ? "Accept the change first" : "";
                const cls = needsAccept && s.status === "todo" ? "locked" : s.status;
                return (
                  <button key={s.stage} className={`stagechip ${cls}`} disabled={disabled} title={title} onClick={() => action("stage", `${c.id}:${s.stage}`)}>
                    <span aria-hidden>{STAGE_ICON[s.stage]}</span> {s.label}{STATE_TEXT[s.status] && <span className="state">{STATE_TEXT[s.status]}</span>}
                  </button>
                );
              })}
            </div>
          )}
          </div>
        </div>
      ))}
      {pending.length > 1 && <button className={`btn ${primaryAccept ? "" : "secondary"} sm`} disabled={busy} onClick={() => action("acceptAll", pending[0].id)}>Accept all ({pending.length})</button>}
    </div>
  );
}
