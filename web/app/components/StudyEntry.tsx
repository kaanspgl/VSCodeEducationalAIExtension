import { useEffect, useRef, useState } from "react";
import { post } from "~/lib/api";
import { md } from "~/lib/md";
import type { ConsentForm, VibeView } from "~/lib/types";

/** Where a participant is on the way in: the consent form comes first, then the sign-in. */
export type EntryStep = "consent" | "signin" | "declined";

/**
 * A participant's way into a study session: read the consent form and agree, then sign in with the code the
 * researcher handed out. Nothing is recorded, and no session starts, before both are done.
 */
export function StudyEntry({ view, consent, step, setStep, onLeave }: {
  view: VibeView; consent: ConsentForm; step: EntryStep; setStep: (s: EntryStep) => void;
  /** Back to the ordinary start screen; absent when this page is only for participants. */
  onLeave?: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // A refused code brings the sign-in back, ready for another try.
  useEffect(() => { if (view.setupError) setSent(false); }, [view.setupError]);
  useEffect(() => { if (step === "signin") input.current?.focus(); }, [step]);

  if (step === "declined") {
    return (
      <div className="start-shell">
        <main className="center-card">
          <header className="start-header">
            <span className="brandmark lg" aria-hidden>V</span>
            <h1>That's fine</h1>
            <p className="muted">You haven't been signed in and nothing has been recorded. Please let the researcher know.</p>
          </header>
          <button className="btn secondary wide" onClick={() => setStep("consent")}>Back to the consent form</button>
        </main>
      </div>
    );
  }

  if (step === "consent") {
    return (
      <div className="start-shell">
        <main className="center-card consentcard">
          <header className="start-header">
            <span className="brandmark lg" aria-hidden>V</span>
            <div className="boxlabel">Step 1 of 2 · Consent</div>
            <h1>Before you start</h1>
          </header>
          <div className="consenttext" tabIndex={0} role="region" aria-label="Consent form" dangerouslySetInnerHTML={{ __html: md(consent.text) }} />
          <label className="check consentcheck">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>{consent.statement}</span>
          </label>
          <button className="btn wide" disabled={!agreed} onClick={() => setStep("signin")}>I consent. Continue to sign in</button>
          <div className="entrylinks">
            <button className="linkbtn" onClick={() => { setAgreed(false); setStep("declined"); }}>I don't want to take part</button>
            {onLeave && <button className="linkbtn" onClick={onLeave}>Not here for the study? Go back</button>}
          </div>
        </main>
      </div>
    );
  }

  const ok = code.trim().length >= 2;
  const start = () => {
    if (!ok || sent) return;
    setSent(true);
    post({ type: "begin", participant: code.trim(), consent: agreed });
  };
  return (
    <div className="start-shell">
      <main className="center-card">
        <header className="start-header">
          <span className="brandmark lg" aria-hidden>V</span>
          <div className="boxlabel">Step 2 of 2 · Sign in</div>
          <h1>Sign in</h1>
          <p className="muted">Type the participant code the researcher gave you. Everything you do in this session is saved under that code, not your name.</p>
        </header>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <label className="field">Participant code
            <input ref={input} type="text" maxLength={32} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="e.g. P014"
              value={code} onChange={(e) => { setCode(e.target.value); setSent(false); }} />
          </label>
          <p className="hint">Please don't type personal information (your name, student number or email) into VibeLearner. Use only the made-up data in the tasks.</p>
          {view.setupError && <p className="alert" role="alert">{view.setupError}</p>}
          <button className="btn wide" type="submit" disabled={!ok || sent}>{sent && !view.setupError ? "Signing in…" : "Start"}</button>
        </form>
        <div className="entrylinks">
          <button className="linkbtn" onClick={() => setStep("consent")}>Back to the consent form</button>
        </div>
      </main>
    </div>
  );
}
