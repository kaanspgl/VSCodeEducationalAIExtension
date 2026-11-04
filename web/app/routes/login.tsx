import { data, Form, redirect, useNavigation } from "react-router";
import { hasAccess, login, sitePassword } from "~/.server/access";
import type { Route } from "./+types/login";

export function meta({}: Route.MetaArgs) {
  return [{ title: "VibeLearner" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (!sitePassword() || hasAccess(request)) throw redirect("/");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const r = await login(request, String(form.get("password") ?? ""));
  if (r.ok) throw redirect("/", { headers: { "Set-Cookie": r.setCookie } });
  return data({ error: r.error }, { status: r.status });
}

/** The site password page. */
export default function Login({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <div className="center-card">
      <h1><span className="dot" />VibeLearner</h1>
      <p className="muted">Enter the password you were given to use this site.</p>
      <Form method="post" className="loginform">
        <label className="field">Password
          <input type="password" name="password" autoComplete="current-password" autoFocus required />
        </label>
        {actionData?.error && <p className="warn">{actionData.error}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
      </Form>
    </div>
  );
}
