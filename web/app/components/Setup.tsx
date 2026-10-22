import { useState } from "react";
import { post } from "~/lib/api";
import type { VibeView } from "~/lib/types";
import { LEVELS } from "./levels";

/** Start screen: pick how to vibe code, or enter a participant code and consent for a research session. */
export function Setup({ view }: { view: VibeView }) {
  const [participant, setParticipant] = useState("");
  const [consent, setConsent] = useState(false);
  const [level, setLevel] = useState<string>(view.level || "guided");
  const research = participant.trim().length > 0;

  return (
    <div className="center-card">
      <h1><span className="dot" />VibeLearner</h1>
      <p className="muted">
        Vibe coding that teaches. Describe what you want and VibeLearner builds it in your project, then helps you understand it:
        thinking it through, walking through the code, predicting what it does, and trying changes yourself.
      </p>
      {!research && (
        <div className="levelbox">
          <div className="hint">How do you want to vibe code?</div>
          {LEVELS.map((l) => (
            <label key={l.v} className="levelopt">
              <input type="radio" name="lvl" value={l.v} checked={level === l.v} onChange={() => setLevel(l.v)} />
              <span><b>{l.label}</b> — {l.desc}</span>
            </label>
          ))}
          <div className="hint">You can change this any time from the header.</div>
        </div>
      )}
      {view.setupError && <p className="warn">{view.setupError}</p>}
      <button className="btn" onClick={() => post({ type: "begin", participant: participant.trim(), consent, level })}>Start</button>
      <details className="research" open={research || undefined}>
        <summary>Taking part in a research study? (optional)</summary>
        <label className="field">Participant code
          <input type="text" maxLength={32} autoComplete="off" placeholder="e.g. P014" value={participant} onChange={(e) => setParticipant(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I have read the information letter, I consent to take part, and I understand my interactions in this session (messages, code changes, answers, timings) are recorded for research.</span>
        </label>
      </details>
    </div>
  );
}
