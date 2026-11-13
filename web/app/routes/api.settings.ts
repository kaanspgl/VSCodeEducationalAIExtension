import { readModelSettings, settingsAllowed, writeModelSettings } from "~/.server/modelSettings";
import type { Route } from "./+types/api.settings";

/** The start screen's model picker: provider, model and API key, for the computer running the server only. */
export async function loader({ request }: Route.LoaderArgs) {
  if (!settingsAllowed(request)) return Response.json({ available: false });
  return Response.json(await readModelSettings(), { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST" || !request.headers.get("Content-Type")?.includes("application/json")) {
    return Response.json({ error: "POST JSON only" }, { status: 400 });
  }
  if (!settingsAllowed(request)) return Response.json({ error: "Model settings can only be changed on the computer running VibeLearner." }, { status: 403 });
  const error = writeModelSettings(await request.json().catch(() => undefined));
  return error ? Response.json({ error }, { status: 400 }) : Response.json({ ok: true });
}
