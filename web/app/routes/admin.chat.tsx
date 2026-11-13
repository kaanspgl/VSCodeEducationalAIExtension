import { useState } from "react";
import { data, redirect } from "react-router";
import { adminPassword, isAdmin } from "~/.server/admin";
import { CODE_RE } from "~/.server/roster";
import { transcript, type TranscriptItem } from "~/.server/transcript";
import { md } from "~/lib/md";
import type { Route } from "./+types/admin.chat";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `VibeLearner · ${params.code ?? ""} conversation` }, { name: "robots", content: "noindex" }];
}

/** One participant's log as the conversation they had (signed-in researchers only). */
export async function loader({ request, params }: Route.LoaderArgs) {
  if (!adminPassword() || !(await isAdmin(request))) throw redirect("/admin");
  const code = params.code ?? "";
  const items = CODE_RE.test(code) ? await transcript(code) : undefined;
  if (!items) throw data("No log for that participant.", { status: 404 });
  return data({ code, items }, { headers: { "Cache-Control": "no-store" } });
}

const time = (ts: string) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

export default function AdminChat({ loaderData }: Route.ComponentProps) {
  const { code, items } = loaderData;
  const [events, setEvents] = useState(true);
  const said = items.filter((i) => i.kind === "student").length;
  return (
    <div className="adminpage">
      <header className="adminhead">
        <span className="brand"><span className="brandmark" aria-hidden>V</span>VibeLearner <span className="muted">· Researcher</span></span>
        <div className="grow" />
        <a className="btn ghost sm" href={`/admin/log/${encodeURIComponent(code)}`} download>Raw log</a>
        <a className="btn ghost sm" href={`/admin/data/${encodeURIComponent(code)}`} download>Files</a>
        <a className="btn secondary sm" href="/admin">Back to participants</a>
      </header>
      <section className="admincard">
        <h2>Conversation of <code>{code}</code></h2>
        <p className="hint">
          Everything {code} typed ({said} message{said === 1 ? "" : "s"}) and what the AI answered, as recorded in their log, with what happened in between:
          steps started, skipped or not possible (and why), changes accepted and programs run. Times are this browser's local time.
        </p>
        <label className="checkrow"><input type="checkbox" checked={events} onChange={(e) => setEvents(e.target.checked)} /> Show what happened between messages</label>
      </section>
      <section className="admincard transcript" aria-label={`Conversation of ${code}`}>
        {items.length === 0 && <p className="hint">The log has nothing to show yet.</p>}
        {items.filter((i) => events || i.kind !== "event").map((item, n) => <Item key={n} item={item} />)}
      </section>
    </div>
  );
}

function Item({ item }: { item: TranscriptItem }) {
  const meta = (
    <span className="tmeta">
      <time dateTime={item.ts} suppressHydrationWarning>{time(item.ts)}</time>
      {item.tags?.map((t) => <span key={t} className="ttag">{t}</span>)}
    </span>
  );
  if (item.kind === "divider") {
    return <div className="tdivider" role="separator"><span>{item.text}</span><time dateTime={item.ts} suppressHydrationWarning>{time(item.ts)}</time></div>;
  }
  if (item.kind === "event") {
    return (
      <div className={`tevent ${item.tone ?? ""}`}>
        <div dangerouslySetInnerHTML={{ __html: md(item.text) }} />
        {meta}
      </div>
    );
  }
  return (
    <div className={`msg ${item.kind}`}>
      {item.kind === "tutor" && <span className="avatar" aria-hidden>V</span>}
      <div className={`tbody ${item.kind}`}>
        <div className={`bubble ${item.tone ? `t${item.tone}` : ""}`}>
          <span className="sr-only">{item.kind === "student" ? "Participant: " : "VibeLearner: "}</span>
          <div dangerouslySetInnerHTML={{ __html: md(item.text) }} />
        </div>
        {meta}
      </div>
    </div>
  );
}
