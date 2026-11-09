import { Link } from "react-router";
import { requireAdmin } from "~/.server/access";
import { CONDITION_LABEL, findParticipant, PARTS } from "~/.server/participants";
import { describe, inPart, partFolder, readLog, statusOf, summarize } from "~/.server/results";
import { Workspace } from "~/.server/workspace";
import type { Route } from "./+types/admin.participant";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.code} · VibeLearner admin` }];
}

const MAX_FILE_BYTES = 200_000;

export async function loader({ request, params }: Route.LoaderArgs) {
  requireAdmin(request);
  const p = findParticipant(params.code);
  if (!p) throw new Response("No such code", { status: 404 });
  const url = new URL(request.url);
  const part = Math.min(PARTS, Math.max(1, Number(url.searchParams.get("part")) || Math.min(p.part, PARTS)));
  const events = readLog(p.code);
  const summaries = summarize(p, events);
  const start = Date.parse(p.parts[part - 1]?.startedAt ?? "") || undefined;

  // Consent and sign-ins are shown with every part; the rest belongs to one part.
  const timeline = events
    .filter((e) => e.type === "consent" || e.type === "sign_in" || inPart(e, part))
    .map((e) => ({ ts: e.ts, since: start ? Math.round((Date.parse(e.ts) - start) / 1000) : undefined, type: e.type, kind: e.data?.kind as string | undefined, text: describe(e), raw: JSON.stringify(e, null, 2) }));

  const ws = new Workspace(partFolder(p.code, part));
  const files = await ws.list();
  const open = url.searchParams.get("file") ?? "";
  const content = open && files.includes(open) ? await ws.read(open, MAX_FILE_BYTES) : undefined;

  return {
    code: p.code,
    order: p.order.map((c) => CONDITION_LABEL[c]),
    consent: p.consent,
    status: statusOf(p),
    part,
    summaries,
    timeline,
    files,
    open: content !== undefined ? open : "",
    content,
  };
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const duration = (s: number) => (s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);
const elapsed = (s?: number) => (s === undefined || s < 0 ? "" : `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** One participant: their parts, a readable timeline of each part, and the files they made in it. */
export default function AdminParticipant({ loaderData: d }: Route.ComponentProps) {
  const s = d.summaries[d.part - 1];
  return (
    <div className="admin">
      <header className="admin-head">
        <Link to="/admin">← All participants</Link>
        <h1>{d.code}</h1>
        <span className="muted">{d.order.join(" → ")} · {d.status} · {d.consent ? `consented ${new Date(d.consent.at).toLocaleString()} (${d.consent.version})` : "not consented yet"}</span>
        <div className="grow" />
        <a href={`/admin/download/${d.code}.jsonl`}>Download log (JSONL)</a>
      </header>

      <nav className="tabs">
        {d.summaries.map((x) => (
          <Link key={x.part} to={`?part=${x.part}`} className={x.part === d.part ? "tab active" : "tab"}>
            Part {x.part}: {x.condition} <span className="muted small">({x.status})</span>
          </Link>
        ))}
      </nav>

      <div className="stats">
        <Stat label="Minutes" value={s.minutes ?? "–"} />
        <Stat label="Requests" value={s.requests} />
        <Stat label="Changes accepted" value={s.accepted} detail={`${s.rejected} rejected`} />
        <Stat label="Predict" value={s.predictTotal ? `${s.predictRight}/${s.predictTotal}` : "–"} />
        <Stat label="Questions" value={s.quizTotal ? `${s.quizRight}/${s.quizTotal}` : "–"} />
        <Stat label="Modify" value={s.challengesGiven ? `${s.challengesDone}/${s.challengesGiven}` : "–"} />
        <Stat label="▶ Run presses" value={s.runs} />
        <Stat label="AI reply time" value={duration(s.aiSeconds)} detail="replies that wrote code" />
      </div>

      <div className="admin-cols">
        <section>
          <h2>Timeline</h2>
          {d.timeline.length === 0 ? <p className="muted">Nothing recorded in this part yet.</p> : (
            <ol className="timeline">
              {d.timeline.map((e, i) => (
                <li key={i} className={`ev ev-${e.type}${e.kind ? ` ev-${e.kind}` : ""}`}>
                  <details>
                    <summary>
                      <span className="t">{clock(e.ts)}</span>
                      <span className="since">{elapsed(e.since)}</span>
                      <span className="what">{e.text}</span>
                    </summary>
                    <pre>{e.raw}</pre>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section>
          <h2>Files in part {d.part}</h2>
          {d.files.length === 0 ? <p className="muted">No files.</p> : (
            <ul className="filelist">
              {d.files.map((f) => (
                <li key={f}><Link to={`?part=${d.part}&file=${encodeURIComponent(f)}`} className={f === d.open ? "active" : ""}>{f}</Link></li>
              ))}
            </ul>
          )}
          {d.open && (
            <>
              <h3>{d.open}</h3>
              <pre className="filecontent">{d.content}</pre>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="stat">
      <div className="muted small">{label}</div>
      <div className="big">{value}</div>
      {detail && <div className="muted small">{detail}</div>}
    </div>
  );
}
