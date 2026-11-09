import { useEffect, useState } from "react";
import { Form } from "react-router";
import { requireStudent } from "~/.server/access";
import { PARTS } from "~/.server/participants";
import { sessionFor } from "~/.server/sessions";
import { ChatPanel } from "~/components/ChatPanel";
import { EditorPane } from "~/components/EditorPane";
import type { Snapshot } from "~/lib/types";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "VibeLearner" },
    { name: "description", content: "Vibe coding that teaches: an AI pair-programmer that explains every change and checks your understanding." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const p = requireStudent(request, "page");
  if (p.part > PARTS) return { done: true as const, code: p.code };
  const { session } = await sessionFor(p);
  return { done: false as const, snap: session.snapshot() };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  if (loaderData.done) return <Finished code={loaderData.code} />;
  return <Coding initial={loaderData.snap} />;
}

function Coding({ initial }: { initial: Snapshot }) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      setConnected(true);
      setSnap(JSON.parse(e.data));
    };
    // EventSource reconnects by itself; show that we're waiting.
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const { view, editor } = snap;
  return (
    <div className="layout">
      {!connected && <div className="offline">Reconnecting to the server…</div>}
      <EditorPane editor={editor} view={view} />
      <ChatPanel view={view} />
    </div>
  );
}

/** Both parts are done. */
function Finished({ code }: { code: string }) {
  return (
    <div className="center-card">
      <h1><span className="dot" />VibeLearner</h1>
      <p>You've finished both parts. Thank you, <b>{code}</b>!</p>
      <p className="muted">Please let the researcher know you're done.</p>
      <Form method="post" action="/logout">
        <button className="btn secondary" type="submit">Sign out</button>
      </Form>
    </div>
  );
}
