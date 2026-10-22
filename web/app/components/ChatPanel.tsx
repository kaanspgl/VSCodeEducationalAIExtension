import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { action, post } from "~/lib/api";
import { md } from "~/lib/md";
import type { VibeChange, VibeMsg, VibeView } from "~/lib/types";
import { LEVELS, STAGE_ICON } from "./levels";

/** The VibeLearner panel: the same chat, change cards, walkthrough, quiz and progress as the extension's webview. */
export function ChatPanel({ view }: { view: VibeView }) {
  const busy = view.busy;
  const logRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [text, setText] = useState("");
  const [projectName, setProjectName] = useState<string | undefined>();

  // A failed send hands the message back so it isn't lost.
  useEffect(() => { if (view.draft != null) setText(view.draft); }, [view.draft]);

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
  return (
    // Pressing any button (Accept, Next, an answer…) means "show me what happens next": follow the log down.
    <section className="panel" onClickCapture={(e) => { if ((e.target as HTMLElement).closest("button")) atBottom.current = true; }}>
      <header className="topbar">
        <div className="brand"><span className="dot" />VibeLearner</div>
        {view.project && (
          <span className="badge projchip" title="Working only inside this folder">
            📂 {view.project}/ <button className="linkbtn" disabled={busy} onClick={() => action("leaveProject")} title="Leave project (see all your files)">✕</button>
          </span>
        )}
        <span className="badge ctxchip" title="What VibeLearner can see">
          📁 {ctx.files} file{ctx.files === 1 ? "" : "s"}{ctx.active ? ` · ${ctx.active}` : ""}{ctx.selection ? <> · <b>{ctx.selection}</b></> : null}
        </span>
        <div className="grow" />
        <label className="levelpick" title={view.levelLocked ? "Fixed for this research session" : "Structured or regular vibe coding"}>Mode
          <select value={view.level} disabled={view.levelLocked || busy} onChange={(e) => action("setLevel", e.target.value)}>
            {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
          </select>
        </label>
        {view.logging && <span className="badge" title="Research logging is on">● {view.participant}</span>}
      </header>

      {learn && <Progress view={view} />}

      <main className="main">
        <StructuredBar view={view} />
        {view.plan && (
          <div className="planbox">
            <div className="quiz-head"><span className="hint">📋 Plan: {view.plan.goal}</span><button className="linkbtn" disabled={busy} onClick={() => action("dropPlan")} title="Stop following this plan">Close</button></div>
            <ol className="plansteps">
              {view.plan.steps.map((s, i) => <li key={i} className={s.status}>{s.status === "done" ? "✓" : s.status === "doing" ? "▶" : "○"} {s.title}</li>)}
            </ol>
            {view.plan.next && (
              <div className="cactions">
                <button className="btn sm" disabled={busy} onClick={() => action("buildNext")}>Build step {view.plan.next.index + 1}: {view.plan.next.title}</button>
                {view.plan.remaining > 1 && <button className="btn secondary sm" disabled={busy} onClick={() => action("buildAll")}>Build the rest at once</button>}
              </div>
            )}
          </div>
        )}

        <div ref={logRef} className="scroll" role="log" aria-live="polite"
          onScroll={(e) => { const l = e.currentTarget; atBottom.current = l.scrollHeight - l.scrollTop - l.clientHeight < 40; }}>
          {view.messages.map((m) => <Message key={m.id} m={m} busy={busy} />)}
          {busy && <div className="msg tutor"><div className="bubble thinking"><span className="spin" />{view.busyLabel || "Working…"}</div></div>}
        </div>

        {view.tour && (
          <div className="tourbox">
            <div className="quiz-head">
              <span className="hint">🧭 Walkthrough · stop {view.tour.index + 1} of {view.tour.total} · <code>{view.tour.path}</code> line{view.tour.start === view.tour.end ? ` ${view.tour.start}` : `s ${view.tour.start}–${view.tour.end}`}{view.tour.pending ? " (proposed)" : ""}</span>
              <button className="linkbtn" disabled={busy} onClick={() => action("tourEnd")}>Exit</button>
            </div>
            <div className="tour-title">{view.tour.title}</div>
            <div dangerouslySetInnerHTML={{ __html: md(view.tour.text) }} />
            <div className="cactions">
              <button className="btn secondary sm" disabled={busy || view.tour.index === 0} onClick={() => action("tourPrev")}>◀ Back</button>
              {view.tour.index + 1 < view.tour.total
                ? <button className="btn sm" disabled={busy} onClick={() => action("tourNext")}>Next ▶</button>
                : <button className="btn sm" disabled={busy} onClick={() => action("tourEnd")}>Finish walkthrough</button>}
              <span className="hint">The highlighted lines are in the editor.</span>
            </div>
          </div>
        )}

        {view.quiz && (
          <div className="quizbox">
            <div className="quiz-head"><span className="hint">{view.quiz.label} · question {view.quiz.index + 1} of {view.quiz.total}</span><button className="linkbtn" disabled={busy} onClick={() => action("skipQuiz")}>Skip</button></div>
            <div className="stem" dangerouslySetInnerHTML={{ __html: md(view.quiz.stem) }} />
            {view.quiz.choices.map((c, i) => (
              <button key={i} className="choice" disabled={busy} onClick={() => post({ type: "quizAnswer", choice: i })}><b>{"ABCD"[i]}.</b> {c}</button>
            ))}
          </div>
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
              <button className="btn secondary sm" disabled={busy} onClick={() => setProjectName("my-project")} title="Start a new program in its own folder">＋ New project</button>
            ) : (
              <form className="inline" onSubmit={(e) => { e.preventDefault(); action("newProject", projectName.trim()); setProjectName(undefined); }}>
                <input type="text" autoFocus value={projectName} maxLength={40} pattern="[\w-]{1,40}" title="Letters, numbers, - or _ (no spaces)"
                  onChange={(e) => setProjectName(e.target.value)} aria-label="Project name" />
                <button className="btn sm" type="submit" disabled={busy || !/^[\w-]{1,40}$/.test(projectName.trim())}>Create</button>
                <button className="linkbtn" type="button" onClick={() => setProjectName(undefined)}>Cancel</button>
              </form>
            )}
            <button className="btn secondary sm" disabled={!ctx.selection || !view.inputEnabled} onClick={() => action("explainSelection")} title="Select code in the editor first">Explain selection</button>
          </div>
          <textarea value={text} disabled={!view.inputEnabled} placeholder={view.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <div className="composer-row">
            <span className="hint">Enter to send · Shift+Enter for a new line</span>
            <div className="grow" />
            <button className="btn" disabled={!view.inputEnabled || !text.trim()} onClick={send}>Send</button>
          </div>
        </div>
      </main>
    </section>
  );
}

function StructuredBar({ view }: { view: VibeView }) {
  const st = view.structured;
  if (!st) return null;
  return (
    <div className="stepbar" title="Structured vibe coding">
      {st.labels.map((label, i) => {
        const n = i + 1;
        return (
          <span key={n} className="sbwrap">
            {i > 0 && <span className="sbarrow">→</span>}
            <span className={`sb ${n < st.step ? "done" : n === st.step ? "now" : ""}`}>
              {n < st.step ? "✓" : n}. {label}{n === st.step && st.sub ? <span className="muted"> · {st.sub}</span> : null}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function Progress({ view }: { view: VibeView }) {
  const [open, setOpen] = useState(false);
  const any = view.skills.some((s) => s.value !== "—") || view.concepts.length > 0;
  return (
    <details className="progress" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>📈 Your progress{any ? "" : <span className="muted"> (builds up as you go)</span>}</summary>
      <div className="skills">
        {view.skills.map((s) => <div key={s.label} className="skill" title={s.detail}><span>{s.label}</span><b>{s.value}</b></div>)}
      </div>
      {view.concepts.length > 0 && (
        <>
          <div className="hint" style={{ marginTop: 6 }}>Concepts you've worked with</div>
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

function Message({ m, busy }: { m: VibeMsg; busy: boolean }) {
  const who = m.role === "student" ? "You" : m.role === "tutor" ? "VibeLearner" : "";
  return (
    <div className={`msg ${m.role}`}>
      <div className="bubble">
        <div dangerouslySetInnerHTML={{ __html: md(m.text) }} />
        {m.changes && <Changes changes={m.changes} busy={busy} />}
        {m.buttons && (
          <div className="cactions">
            {m.buttons.map((b, i) => (
              <button key={i} className={`btn ${b.primary ? "" : "secondary"} sm`} disabled={busy} onClick={() => action(b.cmd, b.arg)}>{b.label}</button>
            ))}
          </div>
        )}
        {m.tip && (
          <details className="tip">
            <summary>💡 Prompt tip <span className="muted">({m.tip.score}/6)</span></summary>
            <div dangerouslySetInnerHTML={{ __html: md(m.tip.text) }} />
            {m.tip.improved && <><div className="hint" style={{ marginTop: 4 }}>A stronger version:</div><div className="improved">{m.tip.improved}</div></>}
          </details>
        )}
        {who && <div className="meta">{who}</div>}
      </div>
    </div>
  );
}

function Changes({ changes, busy }: { changes: VibeChange[]; busy: boolean }) {
  const pending = changes.filter((c) => c.status === "pending");
  return (
    <div className="changes">
      {changes.map((c) => (
        <div key={c.id} className={`change ${c.status}`}>
          <div className="cfile">
            <code>{c.path}</code>{c.isNew && <span className="tag">new file</span>}
            {c.status !== "failed" && <span className="diffstat"><span className="plus">+{c.added}</span> <span className="minus">−{c.removed}</span></span>}
          </div>
          {c.note && <div className="muted small">{c.note}</div>}
          <div className="cactions">
            {c.status === "pending" ? (
              <>
                <button className="btn secondary sm" disabled={busy} onClick={() => action("viewDiff", c.id)}>View diff</button>
                <button className="btn sm" disabled={busy} onClick={() => action("accept", c.id)}>Accept</button>
                <button className="btn secondary sm" disabled={busy} onClick={() => action("reject", c.id)}>Reject</button>
              </>
            ) : c.status === "accepted" ? <span className="ok">✓ Applied</span>
              : c.status === "rejected" ? <span className="muted">Rejected</span>
              : <span className="warn">Couldn't apply</span>}
          </div>
          {c.learn && (
            <div className="learnrow">
              {c.learn.map((s) => {
                const needsAccept = s.stage !== "tour" && c.status !== "accepted";
                const disabled = busy || s.status === "done" || s.status === "na" || s.status === "active" || needsAccept;
                const mark = s.status === "done" ? " ✓" : s.status === "skipped" ? " (skipped)" : s.status === "na" ? " —" : "";
                const title = s.status === "na" ? "Not available for this change" : needsAccept ? "Accept the change first" : "";
                return (
                  <button key={s.stage} className={`stagechip ${s.status}`} disabled={disabled} title={title} onClick={() => action("stage", `${c.id}:${s.stage}`)}>
                    {STAGE_ICON[s.stage]} {s.label}{mark}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      {pending.length > 1 && <button className="btn sm" disabled={busy} onClick={() => action("acceptAll", pending[0].id)}>Accept all ({pending.length})</button>}
    </div>
  );
}
