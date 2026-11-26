import { action, post } from "~/lib/api";
import { clock, nowCard, useElapsed } from "~/lib/flow";
import type { EditorView, VibeView } from "~/lib/types";
import { ChatPanel } from "./ChatPanel";
import { EditorPane } from "./EditorPane";
import { GuidePanel } from "./GuidePanel";
import { Icon } from "./Icon";
import { LEVELS } from "./levels";

/**
 * The working screen, in three columns: what to do (the question and the steps), the code (with the walkthrough,
 * the questions and the program's output under it), and the conversation. Regular vibe coding outside a study has
 * nothing to guide, so it gets the code and the conversation only.
 */
export function Workspace({ view, editor, connected }: { view: VibeView; editor: EditorView; connected: boolean }) {
  const now = nowCard(view);
  const guide = hasGuide(view);
  return (
    <div className={`ws ${guide ? "" : "noguide"}`}>
      {!connected && <div className="offline" role="status">Reconnecting to the server…</div>}
      <TopBar view={view} />
      {guide && <GuidePanel view={view} now={now} />}
      <EditorPane editor={editor} view={view} pointAt={now?.where === "above"} />
      <ChatPanel view={view} attention={!!now && now.where === "chat"} />
    </div>
  );
}

function hasGuide(view: VibeView): boolean {
  return view.study?.step === "work" || view.level === "guided" || !!view.plan || (view.level !== "off" && view.ui.progress);
}

function TopBar({ view }: { view: VibeView }) {
  const st = view.study?.step === "work" ? view.study : undefined;
  return (
    <header className="topbar">
      <span className="brand"><span className="brandmark" aria-hidden>V</span><span className="brandtext">VibeLearner</span></span>
      {st && <span className="partchip">Part {st.part + 1} of {st.parts} <span aria-hidden>·</span> <b>{st.concept}</b></span>}
      {view.project && (
        <span className="badge projchip" title="Working only inside this folder">
          <Icon name="folder" size={12} /> {view.project}/
          <button className="chipx" disabled={view.busy} onClick={() => action("leaveProject")} title="Leave project (see all your files)" aria-label={`Leave project ${view.project}`}>✕</button>
        </span>
      )}
      <div className="grow" />
      {st && st.minutes > 0 && <PartClock started={st.started} minutes={st.minutes} />}
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
