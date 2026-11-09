import { Link, redirect, useSearchParams } from "react-router";
import { currentStudent } from "~/.server/access";
import { AGREE, CONSENT, CONSENT_TITLE, CONSENT_VERSION, DECLINE } from "~/lib/consent";
import type { Route } from "./+types/consent";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Consent · VibeLearner" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (currentStudent(request)) throw redirect("/");
  return null;
}

/** The first page: the consent form. "I agree" leads to the sign-in page; "I do not agree" ends here. */
export default function Consent() {
  const [params] = useSearchParams();
  if (params.has("declined")) {
    return (
      <div className="center-card">
        <h1><span className="dot" />VibeLearner</h1>
        <p>Thank you for considering the study. You've chosen not to take part, and nothing has been recorded.</p>
        <p className="muted">You can close this window now.</p>
        <Link className="linkbtn" to="/consent">Back to the consent form</Link>
      </div>
    );
  }
  return (
    <div className="center-card consent">
      <h1><span className="dot" />{CONSENT_TITLE}</h1>
      <p className="muted">{CONSENT_VERSION}</p>
      {CONSENT.map((s, i) => (
        <section key={i}>
          {s.heading && <h2>{s.heading}</h2>}
          {s.blocks.map((b, j) => Array.isArray(b)
            ? <ul key={j}>{b.map((li, k) => <li key={k}>{li}</li>)}</ul>
            : <p key={j}>{b}</p>)}
        </section>
      ))}
      <div className="consent-actions noprint">
        <Link className="btn" to="/login?consent=1">{AGREE}</Link>
        <Link className="btn secondary" to="/consent?declined=1">{DECLINE}</Link>
        <button className="linkbtn" type="button" onClick={() => window.print()}>Print or save a copy</button>
      </div>
    </div>
  );
}
