import type { Command } from "./types";

/** Sends a command to the session; what it changes comes back over the event stream. */
export function post(cmd: Command): Promise<void> {
  return fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    keepalive: cmd.type === "save",
  }).then((r) => {
    if (r.status === 401) window.location.reload();
  }, () => { /* offline: the event stream shows it */ });
}

export const action = (cmd: string, arg?: string) => post({ type: "action", cmd, arg });
