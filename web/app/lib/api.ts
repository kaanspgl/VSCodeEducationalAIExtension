import type { Command } from "./types";

/** Sends a command to the session; what it changes comes back over the event stream. */
export function post(cmd: Command): Promise<void> {
  return fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    keepalive: cmd.type === "save",
  }).then(async (r) => {
    // Signed out, or moved on to the next part: the page shows where they are now.
    if (r.status === 401) return window.location.reload();
    const body = await r.json().catch(() => undefined);
    if (body?.reload) window.location.reload();
  }, () => { /* offline: the event stream shows it */ });
}

export const action = (cmd: string, arg?: string) => post({ type: "action", cmd, arg });
