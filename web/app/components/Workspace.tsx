import { useState } from "react";
import { action, post } from "~/lib/api";
import { clock, useElapsed } from "~/lib/flow";
import type { EditorView, VibeView } from "~/lib/types";
import { EditorPane } from "./EditorPane";
import { HistoryDrawer } from "./HistoryDrawer";
import { Icon } from "./Icon";
import { LEVELS } from "./levels";
import { TutorPanel } from "./TutorPanel";

type Study = NonNullable<VibeView["study"]>;

/**
 * The working screen: a top bar with the question, the clock and Finish part; the code on the left, taking most
 * of the width; and on the right one card for what is happening with the AI now, with the message box under it.
 * The whole conversation is in the history, one click away.
 */
export function Workspace({ view, editor, connected }: { view: VibeView; editor: EditorView; connected: boolean }) {
  const [history, setHistory] = useState(false);
  return (
    <div className="ws">
      {!connected && <div className="offline" role="status">Reconnecting to the server…</div>}
      <TopBar view={view} onHistory={() => setHistory(true)} />
      <EditorPane editor={editor} view={view} />
      <TutorPanel view={view} />
      {history && <HistoryDrawer view={view} onClose={() => setHistory(false)} />}
    </div>
  );
}

function TopBar({ view, onHistory }: { view: VibeView; onHistory: () => void }) {
  const st = view.study?.step === "work" ? view.study : undefined;
  return (
    <header className="topbar">
      <span className="brand" title="VibeLearner"><span className="brandmark" aria-hidden>V</span>{!st && <span className="brandtext">VibeLearner</span>}</span>
      {st ? <QuestionBar view={view} st={st} /> : <div className="grow" />}
      {view.project && (
        <span className="badge projchip" title="Working only inside this folder">
          <Icon name="folder" size={12} /> {view.project}/
          <button className="chipx" disabled={view.busy} onClick={() => action("leaveProject")} title="Leave project (see all your files)" aria-label={`Leave project ${view.project}`}>✕</button>
        </span>
      )}
      <button className="btn secondary sm historybtn" onClick={onHistory} title="Everything said so far">
        <Icon name="chat" size={13} /> History <span className="count">{view.messages.length}</span>
      </button>
      {st && st.minutes > 0 && <PartClock started={st.started} minutes={st.minutes} />}
      {st && <FinishPart view={view} st={st} />}
      {/* In a research session the mode isn't named: participants aren't told which version they are using. */}
      {view.ui.mode && (
        <label className="levelpick" title="Structured or regular vibe coding">Mode
          <select value={view.level} disabled={view.levelLocked || view.busy} onChange={(e) => action("setLevel", e.target.value)}>
            {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
          </select>
        </label>
      )}
      {view.logging && <span className="badge logbadge" title="Signed in for the study: this session is recorded under this code"><span className="pulse" aria-hidden>●</span> {view.participant}</span>}
      <SignOut view={view} />
    </header>
  );
}

/** The question, which one of how many, and the way between them; always in sight. */
function QuestionBar({ view, st }: { view: VibeView; st: Study }) {
  return (
    <>
      <div className="qnav">
        <button className="btn secondary sm" disabled={view.busy || st.task === 0} onClick={() => action("studyPrev")} title="Previous question" aria-label="Previous question">‹</button>
        <span className="qcount">
          <span className="eyebrow">Part {st.part + 1} · {st.concept}</span>
          <b>Question {st.task + 1} of {st.tasks.length}</b>
        </span>
        <button className="btn secondary sm" disabled={view.busy || st.task >= st.tasks.length - 1} onClick={() => action("studyNext")} title="Next question" aria-label="Next question">›</button>
      </div>
      <p className="qtext">{st.tasks[st.task]}</p>
    </>
  );
}

/** Time on this part against its minutes. Nothing is cut off when it runs out. */
function PartClock({ started, minutes }: { started?: number; minutes: number }) {
  const secs = useElapsed(started);
  if (secs === undefined) return null;
  const over = secs >= minutes * 60;
  const pct = Math.min(100, (secs / (minutes * 60)) * 100);
  return (
    <span className={`partclock ${over ? "over" : ""}`} role="timer" aria-label={`Time on this part: ${clock(secs)} of ${minutes} minutes`}>
      <Icon name="clock" size={13} />
      <span className="ctime">{clock(secs)}</span>
      <span className="muted">/ {minutes}:00</span>
      <span className="cbar" aria-hidden><span style={{ width: `${pct}%` }} /></span>
    </span>
  );
}

/** Finishing the part. With fixed time it unlocks when the clock reaches the part's minutes (the server refuses it too). */
function FinishPart({ view, st }: { view: VibeView; st: Study }) {
  const secs = useElapsed(st.started);
  const last = st.task >= st.tasks.length - 1;
  const over = st.minutes > 0 && secs !== undefined && secs >= st.minutes * 60;
  const locked = !!st.fixedTime && st.minutes > 0 && !over;
  const why = locked
    ? `You can finish this part when the clock reaches ${st.minutes}:00.${last ? " Until then, keep working with your programs any way you like." : ""}`
    : over ? "Time is up: finish what you're doing, then finish the part." : undefined;
  return (
    // Always there: when time is up a participant finishes from wherever they are, without paging through the rest.
    <button className={`btn sm ${(last && !locked) || over ? "" : "secondary"}`} disabled={view.busy || locked} title={why}
      onClick={() => { if (confirm(`Finish part ${st.part + 1}? You can't come back to it afterwards.`)) action("studyFinish"); }}>
      {locked ? <><Icon name="clock" size={12} /> Finish at {st.minutes}:00</> : `Finish part ${st.part + 1}`}
    </button>
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
