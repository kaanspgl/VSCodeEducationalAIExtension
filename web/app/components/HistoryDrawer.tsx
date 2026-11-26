import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { action } from "~/lib/api";
import { DEFAULT_LABELS } from "~/lib/flow";
import type { VibeMsg, VibeView } from "~/lib/types";
import { Icon } from "./Icon";
import { Message } from "./Messages";

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

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plain = (s: string) => s.replace(/\n\n_\(about [^)]*\)_$/, "").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();

/**
 * The whole conversation, one click away instead of a long thread on screen. It folds into a section per study
 * question (outside a study, per request), and in Structured mode a section per step inside it: the newest open,
 * earlier ones one line each.
 */
export function HistoryDrawer({ view, onClose }: { view: VibeView; onClose: () => void }) {
  const logRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Sections the student opened or closed themselves; everything else follows the defaults.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  // Opens on the newest messages.
  useLayoutEffect(() => { const l = logRef.current; if (l) l.scrollTop = l.scrollHeight; }, []);

  const study = view.study?.step === "work" ? view.study : undefined;
  const labels = view.structured?.labels ?? DEFAULT_LABELS;
  const topics = topicsOf(view);
  const cur = topics.length - 1;
  const isOpen = (key: string, byDefault: boolean) => showAll || (toggled[key] ?? byDefault);
  const flip = (key: string, now: boolean) => { setShowAll(false); setToggled((t) => ({ ...t, [key]: !now })); };
  const chips = view.level === "light";

  const topicTitle = (t: Topic, i: number) => {
    if (study && t.task !== undefined) return { name: `Question ${t.task + 1}`, about: study.tasks[t.task] ?? "" };
    const first = t.msgs.find((m) => m.role === "student");
    return first ? { name: "Request", about: plain(first.text) } : { name: i === 0 ? "Getting started" : "Conversation", about: "" };
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Conversation history" onClick={(e) => e.stopPropagation()}>
        <header className="drawerhead">
          <Icon name="chat" size={15} />
          <h2>History</h2>
          <span className="muted">{view.messages.length} message{view.messages.length === 1 ? "" : "s"}</span>
          <div className="grow" />
          {topics.length > 1 && (
            <button className="linkbtn" onClick={() => { setShowAll(!showAll); setToggled({}); }}>{showAll ? "Fold earlier parts" : "Open everything"}</button>
          )}
          <button ref={closeRef} className="btn secondary sm" onClick={onClose}>Close</button>
        </header>
        {view.level !== "off" && view.ui.progress && <Progress view={view} onClose={onClose} />}
        <div ref={logRef} className="scroll" role="log" aria-label="Conversation">
          {topics.length === 0 && <p className="hint empty">No messages yet.</p>}
          {topics.map((t, i) => {
            const current = i === cur;
            const waiting = t.msgs.some((m) => m.changes?.some((c) => c.status === "pending"));
            const open = isOpen(t.key, current || waiting);
            const runs = runsOf(t.msgs);
            const stepRuns = runs.filter((r) => r.step);
            const lastStepRun = stepRuns[stepRuns.length - 1];
            const { name, about } = topicTitle(t, i);
            const steps = [...new Set(stepRuns.map((r) => r.step!))];
            return (
              <section key={t.key} className={`topic ${current ? "current" : ""} ${open ? "open" : ""}`}>
                {topics.length > 1 && (
                  <button className="topichead" aria-expanded={open} onClick={() => flip(t.key, open)}>
                    <span className="chev" aria-hidden><Icon name="chevron" size={11} /></span>
                    <span className="tname">{name}</span>
                    {about && <span className="tabout">{clip(about, 60)}</span>}
                    <span className="grow" />
                    {waiting && <span className="twait">code to accept</span>}
                    {!open && steps.map((n) => <span key={n} className="tstep" title={labels[n - 1]}>{n}</span>)}
                    {!open && <span className="tcount">{t.msgs.length}</span>}
                  </button>
                )}
                {open && (
                  <div className="topicbody">
                    {runs.map((r) => {
                      if (!r.step) return r.msgs.map((m) => <Message key={m.id} m={m} busy={view.busy} primaryAccept={false} chips={chips} />);
                      const latest = r === lastStepRun;
                      const ropen = isOpen(r.key, latest || r.msgs.some((m) => m.changes?.some((c) => c.status === "pending")));
                      return (
                        <div key={r.key} className={`steprun ${ropen ? "open" : ""}`}>
                          <button className="stephead" aria-expanded={ropen} onClick={() => flip(r.key, ropen)}>
                            <span className="snum" aria-hidden>{r.step}</span>
                            <span className="sname">Step {r.step}: {labels[r.step - 1] ?? ""}</span>
                            <span className="grow" />
                            {!ropen && <span className="tcount">{r.msgs.length} message{r.msgs.length === 1 ? "" : "s"}</span>}
                            <span className="chev" aria-hidden><Icon name="chevron" size={11} /></span>
                          </button>
                          {ropen && <div className="runbody">{r.msgs.map((m) => <Message key={m.id} m={m} busy={view.busy} primaryAccept={false} chips={chips} />)}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

/** Outside a study: how the student is doing, built up from the steps they've done. */
function Progress({ view, onClose }: { view: VibeView; onClose: () => void }) {
  const any = view.skills.some((s) => s.value !== "—") || view.concepts.length > 0;
  return (
    <details className="progress">
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
      <div className="cactions"><button className="btn secondary sm" disabled={!view.inputEnabled} onClick={() => { onClose(); action("quizProject"); }}>Quiz me on my program</button></div>
    </details>
  );
}
