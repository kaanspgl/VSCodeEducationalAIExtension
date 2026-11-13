import { useEffect, useState } from "react";
import { data } from "react-router";
import { readConsent } from "~/.server/consent";
import { sessionFor } from "~/.server/sessions";
import { ChatPanel } from "~/components/ChatPanel";
import { EditorPane } from "~/components/EditorPane";
import { Setup } from "~/components/Setup";
import { StudyEntry, type EntryStep } from "~/components/StudyEntry";
import { StudyScreen } from "~/components/StudyScreen";
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
  const { text, statement, version } = readConsent();
  // At /study the page is only for participants: it opens on the consent form and offers nothing else.
  const studyOnly = new URL(request.url).pathname.replace(/\/+$/, "") === "/study";
  return data({ snap: session.snapshot(), consent: { text, statement, version }, studyOnly }, setCookie ? { headers: { "Set-Cookie": setCookie } } : undefined);
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { consent, studyOnly } = loaderData;
  const [snap, setSnap] = useState<Snapshot>(loaderData.snap);
  const [connected, setConnected] = useState(true);
  // On the way in to a study session: the consent form, then the sign-in. Undefined = the ordinary start screen.
  const [entry, setEntry] = useState<EntryStep | undefined>(studyOnly ? "consent" : undefined);

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
  // Once someone is signed in, the way in starts over for the next person (after a sign-out).
  useEffect(() => { if (view.stage !== "setup") setEntry(studyOnly ? "consent" : undefined); }, [view.stage, studyOnly]);

  if (view.stage === "setup") {
    return entry
      ? <StudyEntry view={view} consent={consent} step={entry} setStep={setEntry} onLeave={studyOnly ? undefined : () => setEntry(undefined)} />
      : <Setup view={view} onStudy={() => setEntry("consent")} />;
  }
  if (view.stage === "survey" || view.stage === "done") return <StudyScreen view={view} />;
  return (
    <div className="layout">
      {!connected && <div className="offline">Reconnecting to the server…</div>}
      <EditorPane editor={editor} view={view} />
      <ChatPanel view={view} />
    </div>
  );
}
