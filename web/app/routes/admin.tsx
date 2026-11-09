import { data, Form, Link, redirect, useNavigation } from "react-router";
import { adminLogout, adminMode, requireAdmin } from "~/.server/access";
import { CONDITION_LABEL, createParticipants, listParticipants, PARTS, resetPin, setPart, type OrderMode } from "~/.server/participants";
import { readLog, statusOf, summarize, type PartSummary } from "~/.server/results";
import type { Route } from "./+types/admin";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Admin · VibeLearner" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  requireAdmin(request);
  const rows = listParticipants().map((p) => ({
    code: p.code,
    order: p.order.map((c) => CONDITION_LABEL[c]),
    consentAt: p.consent?.at,
    part: p.part,
    status: statusOf(p),
    parts: summarize(p, readLog(p.code)),
  }));
  return { rows, open: adminMode() === "open", parts: PARTS };
}

type ActionData = { cards?: { code: string; pin: string; order: string[] }[]; pin?: { code: string; pin: string }; error?: string };

export async function action({ request }: Route.ActionArgs) {
  requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const code = String(form.get("code") ?? "");
  if (intent === "logout") throw redirect("/admin/login", { headers: { "Set-Cookie": adminLogout() } });
  if (intent === "create") {
    const count = Number(form.get("count"));
    if (!(count >= 1 && count <= 200)) return data<ActionData>({ error: "Make between 1 and 200 codes at a time." }, { status: 400 });
    const made = createParticipants(count, String(form.get("order")) as OrderMode);
    return data<ActionData>({ cards: made.map((m) => ({ ...m, order: m.order.map((c) => CONDITION_LABEL[c]) })) });
  }
  if (intent === "pin") {
    const pin = resetPin(code);
    return pin ? data<ActionData>({ pin: { code, pin } }) : data<ActionData>({ error: `No code ${code}.` }, { status: 404 });
  }
  if (intent === "part") {
    setPart(code, Number(form.get("part")));
    return data<ActionData>({});
  }
  return data<ActionData>({ error: "Unknown action." }, { status: 400 });
}

const frac = (right: number, total: number) => (total ? `${right}/${total}` : "–");

/** Researchers: participant codes, a summary of each part, and the downloads. */
export default function Admin({ loaderData, actionData }: Route.ComponentProps) {
  const { rows, open, parts } = loaderData;
  const a = actionData as ActionData | undefined;
  const busy = useNavigation().state !== "idle";
  const consented = rows.filter((r) => r.consentAt).length;
  const finished = rows.filter((r) => r.part > parts).length;

  return (
    <div className="admin">
      <header className="admin-head noprint">
        <h1><span className="dot" />VibeLearner admin</h1>
        <div className="grow" />
        <span className="muted">Download:</span>
        <a href="/admin/download/summary.csv">Summary (CSV)</a>
        <a href="/admin/download/logs.jsonl">All logs (JSONL)</a>
        <a href="/admin/download/vibelearner-data.zip">Everything (ZIP)</a>
        {!open && (
          <Form method="post"><button className="linkbtn" name="intent" value="logout">Sign out</button></Form>
        )}
      </header>
      {open && <p className="warn noprint">ADMIN_PASSWORD isn't set: these pages are open because this is a development server. In production they stay closed until it's set.</p>}
      {a?.error && <p className="warn noprint">{a.error}</p>}

      {a?.cards && (
        <section className="cards-wrap">
          <div className="noprint row">
            <h2>New codes: print the cards now</h2>
            <span className="muted">The PINs are shown only this once. A lost card can get a new PIN.</span>
            <div className="grow" />
            <button className="btn" onClick={() => window.print()}>Print cards</button>
          </div>
          <div className="cards">
            {a.cards.map((c) => (
              <div key={c.code} className="card">
                <div className="muted small">VibeLearner study · H25-02775</div>
                <div>Participant code <b className="big">{c.code}</b></div>
                <div>PIN <b className="big">{c.pin}</b></div>
                <div className="small">Keep this card. To withdraw your data within 14 days, email this code to the researchers.</div>
              </div>
            ))}
          </div>
        </section>
      )}
      {a?.pin && <p className="okmsg noprint">New PIN for <b>{a.pin.code}</b>: <b className="big">{a.pin.pin}</b>. The old PIN no longer works.</p>}

      <section className="noprint">
        <div className="row">
          <h2>Participants</h2>
          <span className="muted">{rows.length} codes · {consented} consented · {finished} finished both parts</span>
          <div className="grow" />
          <Form method="post" className="row">
            <input type="hidden" name="intent" value="create" />
            <label>Make <input type="number" name="count" min={1} max={200} defaultValue={10} className="num" /> codes,</label>
            <select name="order" defaultValue="structured-first">
              <option value="structured-first">Structured first, then Regular</option>
              <option value="regular-first">Regular first, then Structured</option>
              <option value="counterbalanced">Counterbalanced (shuffled pairs)</option>
            </select>
            <button className="btn sm" disabled={busy}>Create</button>
          </Form>
        </div>

        {rows.length === 0 ? (
          <p className="muted">No codes yet. Make some above, then print the cards.</p>
        ) : (
          <div className="tablewrap">
            <table className="results">
              <thead>
                <tr>
                  <th>Code</th><th>Consented</th><th>Status</th><th>Part</th><th>Condition</th><th>Minutes</th><th>Requests</th>
                  <th title="Changes accepted / rejected">Changes ✓/✗</th><th>Predict</th><th>Questions</th><th>Modify</th><th title="Times the participant pressed ▶ Run">▶ Runs</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => r.parts.map((s: PartSummary, i: number) => (
                  <tr key={`${r.code}-${s.part}`} className={i === 0 ? "first" : ""}>
                    {i === 0 && (
                      <>
                        <td rowSpan={r.parts.length}><Link to={`/admin/p/${r.code}`}><b>{r.code}</b></Link></td>
                        <td rowSpan={r.parts.length}>{r.consentAt ? new Date(r.consentAt).toLocaleString() : <span className="muted">not yet</span>}</td>
                        <td rowSpan={r.parts.length}>{r.status}</td>
                      </>
                    )}
                    <td>{s.part}</td>
                    <td><span className={`cond ${s.condition.toLowerCase()}`}>{s.condition}</span>{s.status !== "finished" && <span className="muted small"> · {s.status}</span>}</td>
                    <td>{s.minutes ?? "–"}</td>
                    <td>{s.requests}</td>
                    <td>{s.accepted}/{s.rejected}</td>
                    <td>{frac(s.predictRight, s.predictTotal)}</td>
                    <td>{frac(s.quizRight, s.quizTotal)}</td>
                    <td>{frac(s.challengesDone, s.challengesGiven)}</td>
                    <td>{s.runs}</td>
                    {i === 0 && (
                      <td rowSpan={r.parts.length} className="actions">
                        <Link to={`/admin/p/${r.code}`}>Timeline & files</Link>
                        <Form method="post" onSubmit={(e) => { if (!window.confirm(`Give ${r.code} a new PIN? The old one stops working.`)) e.preventDefault(); }}>
                          <input type="hidden" name="code" value={r.code} />
                          <button className="linkbtn" name="intent" value="pin" disabled={busy}>New PIN</button>
                        </Form>
                        <Form method="post" className="row">
                          <input type="hidden" name="code" value={r.code} />
                          <select name="part" defaultValue={r.part} key={r.part}>
                            {Array.from({ length: parts }, (_, k) => <option key={k} value={k + 1}>Part {k + 1}</option>)}
                            <option value={parts + 1}>Finished</option>
                          </select>
                          <button className="linkbtn" name="intent" value="part" disabled={busy}>Move</button>
                        </Form>
                      </td>
                    )}
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">
          Predict: predictions that matched what the program printed. Questions: multiple-choice answers right. Modify: challenges
          finished / given. Minutes run from the start of a part to its "Finish" button (or its last event while it's still going).
        </p>
      </section>
    </div>
  );
}
