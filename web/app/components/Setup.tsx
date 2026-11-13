import { useState } from "react";
import { post } from "~/lib/api";
import type { VibeView } from "~/lib/types";
import { Icon } from "./Icon";
import { LEVELS } from "./levels";
import { ModelPicker } from "./ModelPicker";

/** Start screen: pick how to vibe code and start, or go to the study's consent form and sign-in. */
export function Setup({ view, onStudy }: { view: VibeView; onStudy: () => void }) {
  const [level, setLevel] = useState<string>(view.level || "guided");

  return (
    <div className="start-shell">
    <main className="center-card">
      <header className="start-header">
        <span className="brandmark lg" aria-hidden>V</span>
        <h1>VibeLearner</h1>
        <p className="muted">
          Vibe coding that teaches. Describe what you want and VibeLearner builds it in your project, then helps you understand it:
          thinking it through, walking through the code, predicting what it does, and trying changes yourself.
        </p>
      </header>
      <button className="studyentry" onClick={onStudy}>
        <span>
          <b>Taking part in a research study?</b>
          <span className="muted">Read the consent form, then sign in with your participant code.</span>
        </span>
        <Icon name="chevron" size={16} />
      </button>
      <fieldset className="levelbox">
        <legend>How do you want to vibe code?</legend>
        {LEVELS.map((l) => (
          <label key={l.v} className={`levelopt ${level === l.v ? "on" : ""}`}>
            <input type="radio" name="lvl" value={l.v} checked={level === l.v} onChange={() => setLevel(l.v)} />
            <span className="dot" aria-hidden />
            <span><b>{l.label}</b><span className="muted">{l.desc}</span></span>
          </label>
        ))}
        <div className="hint">You can change this any time from the header.</div>
      </fieldset>
      <ModelPicker />
      <button className="btn wide" onClick={() => post({ type: "begin", level })}>Start</button>
      <p className="hint">Starting here is not part of the study: nothing is recorded.</p>
    </main>
    </div>
  );
}
