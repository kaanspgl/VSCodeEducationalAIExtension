import { useEffect, useState } from "react";
import { action, post } from "~/lib/api";
import type { VibeView } from "~/lib/types";

/** Between the parts of a study: the quiz to take before or after a part, and the thank-you at the end. */
export function StudyScreen({ view }: { view: VibeView }) {
  const st = view.study;
  const [opened, setOpened] = useState(false);
  const [sent, setSent] = useState(false);
  // A new quiz step starts with its button locked again.
  useEffect(() => { setOpened(false); setSent(false); }, [st?.part, st?.step]);

  if (!st || view.stage === "done" || st.step === "done") {
    return (
      <div className="start-shell">
        <main className="center-card">
          <header className="start-header">
            <span className="brandmark lg" aria-hidden>V</span>
            <h1>{st?.url ? "One last step" : "All done. Thank you!"}</h1>
            <p className="muted">
              {st?.url
                ? "You've finished both coding parts. Please answer a short questionnaire about how each one went. After that you're done."
                : "You've finished every part of the study. You can close this tab now."}
            </p>
          </header>
          {st?.url && <a className="btn wide" href={st.url} target="_blank" rel="noreferrer">Open the questionnaire</a>}
          {st?.url && <p className="hint">Thank you for taking part. When you've submitted the questionnaire, tell the researcher.</p>}
          <SignOutLink view={view} done />
        </main>
      </div>
    );
  }

  const before = st.step === "pre";
  return (
    <div className="start-shell">
      <main className="center-card">
        <header className="start-header">
          <span className="brandmark lg" aria-hidden>V</span>
          <div className="boxlabel">Part {st.part + 1} of {st.parts} · {st.concept}</div>
          <h1>{before ? "First, a short quiz" : "Now the same kind of quiz again"}</h1>
          <p className="muted">
            {before
              ? `Before you start this part, please answer a short quiz about ${st.concept}. It only shows us what you know already, so don't worry about wrong answers.`
              : `You've finished the questions for this part. Please answer a short quiz about ${st.concept} so we can see what changed.`}
          </p>
        </header>
        <ol className="studysteps">
          <li>
            <span>Open the quiz. It opens in a new tab.</span>
            <a className={`btn ${opened ? "secondary" : ""}`} href={st.url} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}>Open the quiz</a>
          </li>
          <li>
            <span>When you've submitted it, come back to this tab and continue.</span>
            <button className="btn" disabled={!opened || sent} onClick={() => { setSent(true); action("studyContinue"); }}>
              {before ? "I've finished the quiz. Start the questions" : st.part + 1 < st.parts ? "I've finished the quiz. Go to the next part" : "I've finished the quiz"}
            </button>
          </li>
        </ol>
        {!opened && <p className="hint">The second button unlocks once you've opened the quiz.</p>}
        <SignOutLink view={view} />
      </main>
    </div>
  );
}

/** Frees this browser for the next person. The participant's place in the study stays saved under their code. */
function SignOutLink({ view, done }: { view: VibeView; done?: boolean }) {
  if (!view.participant) return null;
  const ask = done
    ? `Sign out ${view.participant} and get this computer ready for the next participant?`
    : `Sign out ${view.participant}? Your place in the study is saved: sign in with the same code to carry on.`;
  return (
    <div className="entrylinks">
      <span className="hint">Signed in as <code>{view.participant}</code></span>
      <button className="linkbtn" onClick={() => { if (confirm(ask)) post({ type: "reset" }); }}>
        {done ? "For the researcher: sign out for the next participant" : "Sign out"}
      </button>
    </div>
  );
}
