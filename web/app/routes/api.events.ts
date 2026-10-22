import { sessionFor, subscribe } from "~/.server/sessions";
import type { Route } from "./+types/api.events";

/** Server-Sent Events: the session's full state, sent on connect and after every change. */
export async function loader({ request }: Route.LoaderArgs) {
  const { sid, session, setCookie } = await sessionFor(request);
  if (setCookie) return new Response("No session", { status: 401 });

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = subscribe(sid, (s) => send(`data: ${JSON.stringify(s)}\n\n`));
      const ping = setInterval(() => send(": ping\n\n"), 15000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      send(`data: ${JSON.stringify(session.snapshot())}\n\n`);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      // no-transform keeps compression middleware from buffering the stream
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
