import { useState } from "react";
import { action } from "~/lib/api";
import { flowSteps, useElapsed, type Now } from "~/lib/flow";
import { md } from "~/lib/md";
import type { VibeView } from "~/lib/types";
import { Icon } from "./Icon";

type Study = NonNullable<VibeView["study"]>;

/**
 * Left column: what to do. The study question, the one thing to do now, and the Structured steps with their parts
 * ticked off as they happen. Outside a study it holds the plan for a big build and the progress panel.
 */
export function GuidePanel({ view, now }: { view: VibeView; now?: Now }) {
  const st = view.study?.step === "work" ? view.study : undefined;
  const guided = view.level === "guided";
  return (
    <aside className="guide" aria-label="What to do">
      <div className="guide-scroll">
        {st && <TaskCard view={view} st={st} />}
        {now && <NowCard now={now} busy={view.busy} />}
        {guided && <Steps view={view} study={!!st} />}
        {view.plan && <PlanBox view={view} />}
        {view.level !== "off" && view.ui.progress && <Progress view={view} />}
      </div>
      {st && <PartFooter view={view} st={st} />}
    </aside>
  );
}

/** The study question, which one of how many, and the way between them. */
function TaskCard({ view, st }: { view: VibeView; st: Study }) {
  const last = st.task >= st.tasks.length - 1;
  return (
    <section className="taskcard" aria-label="Your question">
      <div className="taskhead">
        <span className="eyebrow">Question {st.task + 1} of {st.tasks.length}</span>
        <ol className="qdots" aria-hidden>
          {st.tasks.map((_, i) => <li key={i} className={i === st.task ? "cur" : i < st.task ? "past" : ""}>{i + 1}</li>)}
        </ol>
      </div>
      <p className="tasktext">{st.tasks[st.task]}</p>
      <div className="tasknav">
        <button className="btn secondary sm" disabled={view.busy || st.task === 0} onClick={() => action("studyPrev")}>◀ Previous</button>
        {!last && <button className="btn secondary sm" disabled={view.busy} onClick={() => action("studyNext")}>Next question ▶</button>}
      </div>
    </section>
  );
}

/** The one thing to do now, and where to do it. */
function NowCard({ now, busy }: { now: Now; busy: boolean }) {
  return (
    <section className={`nowcard ${now.busy ? "busy" : ""} ${now.done ? "done" : ""}`} aria-label="What to do now" aria-live="polite">
      <div className="eyebrow">
        {now.busy ? <><span className="spin" aria-hidden /> Please wait</> : now.done ? <><Icon name="check" size={12} /> Well done</> : <><Icon name="arrow" size={12} /> Do this now</>}
      </div>
      <div className="nowtitle">{now.title}</div>
      {now.markdown && <div className="nowtask" dangerouslySetInnerHTML={{ __html: md(now.markdown) }} />}
      {now.text && <p className="nowtext">{now.text}</p>}
      {now.where && (
        <div className="nowwhere">
          <Icon name={now.where === "chat" ? "chat" : now.where === "above" ? "up" : "terminal"} size={13} />
          {now.where === "chat" ? "In the chat box, bottom right" : now.where === "above" ? "In the bar above the code" : "In the box under the code"}
        </div>
      )}
      {now.actions && (
        <div className="cactions">
          {now.actions.map((b, i) => (
            <button key={i} className={`btn sm ${b.primary ? "" : "secondary"}`} disabled={busy} onClick={() => action(b.cmd, b.arg)}>{b.label}</button>
          ))}
        </div>
      )}
    </section>
  );
}

/** The Structured steps as a checklist: each step, its parts, and which one is happening now. */
function Steps({ view, study }: { view: VibeView; study: boolean }) {
  const steps = flowSteps(view);
  return (
    <section className="steps" aria-label="Steps">
      <div className="eyebrow">{study ? "Steps for this question" : "Steps for each request"}</div>
      <ol className="vsteps">
        {steps.map((s) => (
          <li key={s.n} className={`vstep ${s.status}`} aria-current={s.status === "now" ? "step" : undefined}>
            <span className="vnum" aria-hidden>{s.status === "done" ? <Icon name="check" size={12} /> : s.n}</span>
            <div className="vbody">
              <div className="vlabel">
                <span className="sr-only">{s.status === "done" ? "Done: " : s.status === "now" ? "Now: " : "Later: "}</span>
                {s.label}
                {s.status === "now" && <span className="nowtag" aria-hidden>now</span>}
              </div>
              {s.desc && <div className="vdesc">{s.desc}</div>}
              {s.subs.length > 0 && (
                <ul className="vsubs">
                  {s.subs.map((x) => (
                    <li key={x.key} className={x.status}>
                      <span className="vdot" aria-hidden>{x.status === "done" ? "✓" : x.status === "skipped" ? "–" : ""}</span>
                      <span>
                        {x.label}
                        {x.detail && <span className="vdetail">{x.detail}</span>}
                        {x.status === "skipped" && <span className="vdetail">skipped</span>}
                        {x.status === "na" && <span className="vdetail">not needed here</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
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

/** Finishing the part. With fixed time it unlocks when the clock reaches the part's minutes (the server refuses it too). */
function PartFooter({ view, st }: { view: VibeView; st: Study }) {
  const secs = useElapsed(st.started);
  const last = st.task >= st.tasks.length - 1;
  const over = st.minutes > 0 && secs !== undefined && secs >= st.minutes * 60;
  const locked = !!st.fixedTime && st.minutes > 0 && !over;
  return (
    <footer className="partfoot">
      {locked && last && (
        <p className="hint">This is the last question. The part goes on until the clock reaches {st.minutes}:00: until then, keep working with your programs any way you like.</p>
      )}
      {over && <p className="hint warn">Time is up: finish what you're doing, then finish the part.</p>}
      {/* Always there: when time is up a participant finishes from wherever they are, without paging through the rest. */}
      <button className={`btn wide ${(last && !locked) || over ? "" : "secondary"}`} disabled={view.busy || locked}
        title={locked ? `You can finish this part when the clock reaches ${st.minutes}:00` : undefined}
        onClick={() => { if (confirm(`Finish part ${st.part + 1}? You can't come back to it afterwards.`)) action("studyFinish"); }}>
        {locked ? <><Icon name="clock" size={13} /> Finish part {st.part + 1} at {st.minutes}:00</> : `Finish part ${st.part + 1}`}
      </button>
    </footer>
  );
}
