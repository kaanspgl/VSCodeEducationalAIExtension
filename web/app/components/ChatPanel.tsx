import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { action, post } from "~/lib/api";
import { DEFAULT_LABELS } from "~/lib/flow";
import { md } from "~/lib/md";
import type { VibeChange, VibeMsg, VibeView } from "~/lib/types";
import { Icon } from "./Icon";
import { STAGE_ICON } from "./levels";

/** A stretch of the conversation about one study question (or, outside a study, one request). */
type Topic = { key: string; task?: number; msgs: VibeMsg[] };
/** Consecutive messages in one Structured step (or outside the steps, `step` undefined). */
type Run = { key: string; step?: number; msgs: VibeMsg[] };

function topicsOf(view: VibeView): Topic[] {
  const study = view.study?.step === "work" ? view.study : undefined;
  const out: (Topic & { id: string })[] = [];
  for (const m of view.messages) {
    const id = study ? `t${m.task ?? "-"}` : `r${m.round ?? 0}`;
    const last = out[out.length - 1];
    if (last?.id === id) last.msgs.push(m);
    else out.push({ id, key: `${id}@${m.id}`, task: m.task, msgs: [m] });
  }
  // The question on screen always has its own section, even before anything is said in it.
  if (study && out[out.length - 1]?.task !== study.task) out.push({ id: `t${study.task}`, key: `t${study.task}@new`, task: study.task, msgs: [] });
  return out;
}

function runsOf(msgs: VibeMsg[]): Run[] {
  const out: Run[] = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.step === m.step) last.msgs.push(m);
    else out.push({ key: `s${m.step ?? "-"}@${m.id}`, step: m.step, msgs: [m] });
  }
  return out;
}

const hasPending = (m: VibeMsg) => !!m.changes?.some((c) => c.status === "pending");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plain = (s: string) => s.replace(/\n\n_\(about [^)]*\)_$/, "").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();

/**
 * Right column: the conversation, folded into sections. In a study each question has its own section, and inside
 * it each Structured step; earlier ones fold away so the current one is what you see. Any section opens with a click.
 */
export function ChatPanel({ view, attention }: { view: VibeView; attention: boolean }) {
  const busy = view.busy;
  const logRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [text, setText] = useState("");
  const [projectName, setProjectName] = useState<string | undefined>();
  // Scrolled well up from the newest message: offer a way back down.
  const [farUp, setFarUp] = useState(false);
  // Sections the student opened or closed themselves; everything else follows the defaults.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);

  // A failed send hands the message back so it isn't lost.
  useEffect(() => { if (view.draft) setText(view.draft.text); }, [view.draft?.id]);

  // Pressing any button on the page (Accept, Next, an answer…) means "show me what happens next": follow the
  // conversation down. Opening or closing a section of it doesn't.
  useEffect(() => {
    const follow = (e: MouseEvent) => {
      const b = (e.target as HTMLElement | null)?.closest("button");
      if (b && !b.matches(".topichead, .stephead, .jump")) atBottom.current = true;
    };
    document.addEventListener("click", follow, true);
    return () => document.removeEventListener("click", follow, true);
  }, []);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && atBottom.current) log.scrollTop = log.scrollHeight;
  }, [view.messages.length, view.busy, view.messages[view.messages.length - 1]?.text, view.study?.task]);

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
    atBottom.current = true;
    post({ type: "send", text: t, target: view.target, ...(pasted ? { pasted: Math.min(pasted, t.length) } : {}) });
  };

  const ctx = view.ctx;
  // One primary action at a time: while a walkthrough or question is open, that box has it, not Accept or Send.
  const boxOpen = !!(view.tour || view.quiz);
  const acceptMsg = boxOpen ? undefined : [...view.messages].reverse().find((m) => m.changes?.some((c) => c.status === "pending"))?.id;

  const study = view.study?.step === "work" ? view.study : undefined;
  const labels = view.structured?.labels ?? DEFAULT_LABELS;
  const topics = topicsOf(view);
  const cur = topics.length - 1;
  const isOpen = (key: string, byDefault: boolean) => showAll || (toggled[key] ?? byDefault);
  const flip = (key: string, now: boolean) => { setShowAll(false); setToggled((t) => ({ ...t, [key]: !now })); };
  const folded = topics.length > 1 || topics.some((t) => runsOf(t.msgs).filter((r) => r.step).length > 1);

  const topicTitle = (t: Topic, i: number) => {
    if (study && t.task !== undefined) return { name: `Question ${t.task + 1}`, about: study.tasks[t.task] ?? "" };
    const first = t.msgs.find((m) => m.role === "student");
    return first ? { name: "Request", about: plain(first.text) } : { name: i === 0 ? "Getting started" : "Conversation", about: "" };
  };

  return (
    <section className="panel" aria-label="Conversation">
      <div className="panelhead">
        <Icon name="chat" size={14} />
        <span className="phtitle">Conversation</span>
        <div className="grow" />
        {folded && (
          <button className="linkbtn" onClick={() => { setShowAll(!showAll); setToggled({}); }}>
            {showAll ? "Fold earlier parts" : "Show everything"}
          </button>
        )}
      </div>

      <div className="logwrap">
        <div ref={logRef} className="scroll" role="log" aria-live="polite" aria-label="Conversation"
          onScroll={(e) => {
            const l = e.currentTarget;
            const gap = l.scrollHeight - l.scrollTop - l.clientHeight;
            atBottom.current = gap < 40;
            setFarUp(gap > 240);
          }}>
          {topics.map((t, i) => {
            const current = i === cur;
            // Code still waiting to be accepted or rejected never folds out of sight.
            const waiting = t.msgs.some(hasPending);
            const open = isOpen(t.key, current || waiting);
            const runs = runsOf(t.msgs);
            const stepRuns = runs.filter((r) => r.step);
            const lastStepRun = stepRuns[stepRuns.length - 1];
            const { name, about } = topicTitle(t, i);
            const steps = [...new Set(stepRuns.map((r) => r.step!))];
            // Outside a study, a lone section needs no header.
            const header = !!study || topics.length > 1;
            return (
              <section key={t.key} className={`topic ${current ? "current" : ""} ${open ? "open" : ""}`}>
                {header && (
                  <button className="topichead" aria-expanded={open} onClick={() => flip(t.key, open)}>
                    <span className="chev" aria-hidden><Icon name="chevron" size={11} /></span>
                    <span className="tname">{name}</span>
                    {about && <span className="tabout">{clip(about, 70)}</span>}
                    <span className="grow" />
                    {waiting && <span className="twait">code to accept</span>}
                    {!open && steps.map((n) => <span key={n} className="tstep" title={labels[n - 1]}>{n}</span>)}
                    {!open && <span className="tcount">{t.msgs.length} message{t.msgs.length === 1 ? "" : "s"}</span>}
                    {current && open && <span className="tnow">current</span>}
                  </button>
                )}
                {open && (
                  <div className="topicbody">
                    {t.msgs.length === 0 && <p className="hint emptytopic">Nothing here yet for this question.</p>}
                    {runs.map((r) => {
                      if (!r.step) return r.msgs.map((m) => <Message key={m.id} m={m} busy={busy} primaryAccept={m.id === acceptMsg} />);
                      const latest = r === lastStepRun;
                      const live = current && latest && !!view.structured && !view.structured.done && view.structured.step === r.step;
                      const done = !live && (!latest || !current || !!view.structured?.done || (view.structured?.step ?? 0) > r.step);
                      const ropen = isOpen(r.key, latest || r.msgs.some(hasPending));
                      return (
                        <div key={r.key} className={`steprun ${live ? "live" : ""} ${ropen ? "open" : ""}`}>
                          <button className="stephead" aria-expanded={ropen} onClick={() => flip(r.key, ropen)}>
                            <span className={`snum ${done ? "done" : live ? "now" : ""}`} aria-hidden>{done ? <Icon name="check" size={10} /> : r.step}</span>
                            <span className="sname">Step {r.step}: {labels[r.step - 1] ?? ""}</span>
                            <span className="grow" />
                            {!ropen && <span className="tcount">{r.msgs.length} message{r.msgs.length === 1 ? "" : "s"}</span>}
                            {live && <span className="tnow">now</span>}
                            <span className="chev" aria-hidden><Icon name="chevron" size={11} /></span>
                          </button>
                          {ropen && <div className="runbody">{r.msgs.map((m) => <Message key={m.id} m={m} busy={busy} primaryAccept={m.id === acceptMsg} />)}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          {busy && <div className="thinking" role="status"><span className="spin" aria-hidden />{view.busyLabel || "Working…"}</div>}
        </div>
        {farUp && (
          <button className="jump" onClick={() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" })}>
            <Icon name="down" size={13} /> Jump to latest
          </button>
        )}
      </div>

      <div className={`composer ${attention && view.inputEnabled ? "attention" : ""}`}>
        <div className="composer-meta">
          <span className="seechip" title="What VibeLearner can see when you send a message">
            <Icon name="folder" size={12} /> {ctx.files} file{ctx.files === 1 ? "" : "s"}{ctx.active ? ` · ${ctx.active}` : ""}{ctx.selection ? <> · <b>{ctx.selection}</b></> : null}
          </span>
          <div className="grow" />
          <label className="targetpick" title="Where should new code go?">Code goes in
            <select value={view.target} disabled={busy} onChange={(e) => action("setTarget", e.target.value)}>
              <option value="auto">Auto</option>
              <option value="new">A new file</option>
              {view.targets.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          {!study && (projectName === undefined ? (
            <button className="btn ghost sm" disabled={busy} onClick={() => setProjectName("my-project")} title="Start a new program in its own folder"><Icon name="plus" size={12} /> New project</button>
          ) : (
            <form className="inline" onSubmit={(e) => { e.preventDefault(); action("newProject", projectName.trim()); setProjectName(undefined); }}>
              <input type="text" autoFocus value={projectName} maxLength={40} pattern="[\w\-]{1,40}" title="Letters, numbers, - or _ (no spaces)"
                onChange={(e) => setProjectName(e.target.value)} aria-label="Project name" />
              <button className="btn sm" type="submit" disabled={busy || !/^[\w-]{1,40}$/.test(projectName.trim())}>Create</button>
              <button className="linkbtn" type="button" onClick={() => setProjectName(undefined)}>Cancel</button>
            </form>
          ))}
        </div>
        <div className="composer-row">
          <textarea value={text} disabled={!view.inputEnabled} placeholder={view.placeholder} aria-label="Message to VibeLearner"
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => takeText(e, e.clipboardData.getData("text"))}
            onDrop={(e) => takeText(e, e.dataTransfer.getData("text"))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className={`btn ${boxOpen ? "secondary" : ""}`} disabled={!view.inputEnabled || !text.trim()} onClick={send}><Icon name="send" size={15} /> Send</button>
        </div>
        {pasteRefused && view.ui.noPaste
          ? <span className="hint" role="status">Pasting is turned off here. Describe what you want in your own words.</span>
          : <span className="hint">{view.quiz ? "Answer the question under the code first." : "Enter to send · Shift+Enter for a new line"}</span>}
      </div>
    </section>
  );
}

function Message({ m, busy, primaryAccept }: { m: VibeMsg; busy: boolean; primaryAccept: boolean }) {
  // ▶ Run's output is under the editor; the conversation keeps a line that opens to show it.
  if (m.look === "output") {
    const [head, ...rest] = m.text.split("\n");
    return (
      <div className="msg system">
        <details className="runline">
          <summary><span className="chev" aria-hidden><Icon name="chevron" size={10} /></span><span dangerouslySetInnerHTML={{ __html: md(head.replace(/:\s*$/, "")) }} /></summary>
          <div dangerouslySetInnerHTML={{ __html: md(rest.join("\n")) }} />
        </details>
      </div>
    );
  }
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
        <div key={c.id} className={`change ${c.status}`}>
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
      ))}
      {pending.length > 1 && <button className={`btn ${primaryAccept ? "" : "secondary"} sm`} disabled={busy} onClick={() => action("acceptAll", pending[0].id)}>Accept all ({pending.length})</button>}
    </div>
  );
}
