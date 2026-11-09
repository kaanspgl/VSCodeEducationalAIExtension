import { data, Form, Link, redirect, useNavigation } from "react-router";
import { currentStudent, studentLogin } from "~/.server/access";
import { logEvent } from "~/.server/logger";
import { recordConsent } from "~/.server/participants";
import { CONSENT_VERSION } from "~/lib/consent";
import type { Route } from "./+types/login";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Sign in · VibeLearner" }];
}

/** Only reached from "I agree" on the consent page. */
export async function loader({ request }: Route.LoaderArgs) {
  if (currentStudent(request)) throw redirect("/");
  if (!new URL(request.url).searchParams.has("consent")) throw redirect("/consent");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  if (form.get("consent") !== "1") throw redirect("/consent");
  const r = await studentLogin(request, String(form.get("code") ?? ""), String(form.get("pin") ?? ""));
  if (!r.ok) return data({ error: r.error }, { status: r.status });
  const p = r.value;
  // The consent given on the page before, recorded against the code the first time it signs in.
  if (recordConsent(p.code, CONSENT_VERSION)) await logEvent(p.code, "consent", { agreed: true, version: CONSENT_VERSION });
  await logEvent(p.code, "sign_in", undefined, p.part);
  throw redirect("/", { headers: { "Set-Cookie": r.setCookie } });
}

/** Sign in with the code and PIN on the participant's card. */
export default function Login({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <div className="center-card">
      <h1><span className="dot" />VibeLearner</h1>
      <p className="muted">Thank you for agreeing to take part. Enter the participant code and PIN from the card you were given.</p>
      <Form method="post" className="loginform">
        <input type="hidden" name="consent" value="1" />
        <label className="field">Participant code
          <input type="text" name="code" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={32} placeholder="e.g. P014" autoFocus required />
        </label>
        <label className="field">PIN
          <input type="password" name="pin" inputMode="numeric" autoComplete="off" maxLength={12} required />
        </label>
        {actionData?.error && <p className="warn">{actionData.error}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
      </Form>
      <p className="hint">Please don't type personal information (your name, student number or email) into VibeLearner. Use only the made-up data in the tasks.</p>
      <Link className="linkbtn" to="/consent">Back to the consent form</Link>
    </div>
  );
}
