import { useEffect, useState } from "react";
import { data } from "react-router";
import { sessionFor } from "~/.server/sessions";
import { ChatPanel } from "~/components/ChatPanel";
import { EditorPane } from "~/components/EditorPane";
import { Setup } from "~/components/Setup";
import type { Snapshot } from "~/lib/types";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "VibeLearner" },
    { name: "description", content: "Vibe coding that teaches: an AI pair-programmer that explains every change and checks your understanding." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { session, setCookie } = await sessionFor(request);
  return data(session.snapshot(), setCookie ? { headers: { "Set-Cookie": setCookie } } : undefined);
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const [snap, setSnap] = useState<Snapshot>(loaderData);
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
  if (view.stage === "setup") return <Setup view={view} />;
  return (
    <div className="layout">
      {!connected && <div className="offline">Reconnecting to the server…</div>}
      <EditorPane editor={editor} view={view} />
      <ChatPanel view={view} />
    </div>
  );
}
