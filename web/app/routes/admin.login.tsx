import { data, Form, redirect, useNavigation } from "react-router";
import { adminLogin, adminMode, isAdmin } from "~/.server/access";
import type { Route } from "./+types/admin.login";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Admin sign in · VibeLearner" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (isAdmin(request)) throw redirect("/admin");
  return { closed: adminMode() === "closed" };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const r = await adminLogin(request, String(form.get("password") ?? ""));
  if (r.ok) throw redirect("/admin", { headers: { "Set-Cookie": r.setCookie } });
  return data({ error: r.error }, { status: r.status });
}

/** The researchers' password page. */
export default function AdminLogin({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  if (loaderData.closed) {
    return (
      <div className="center-card">
        <h1><span className="dot" />VibeLearner admin</h1>
        <p className="warn">The admin pages are off. Set ADMIN_PASSWORD for the app and restart it.</p>
      </div>
    );
  }
  return (
    <div className="center-card">
      <h1><span className="dot" />VibeLearner admin</h1>
      <p className="muted">For the research team.</p>
      <Form method="post" className="loginform">
        <label className="field">Admin password
          <input type="password" name="password" autoComplete="current-password" autoFocus required />
        </label>
        {actionData?.error && <p className="warn">{actionData.error}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
      </Form>
    </div>
  );
}
