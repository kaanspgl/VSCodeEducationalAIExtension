import { data, Form, redirect, useNavigation } from "react-router";
import { adminPassword, currentFingerprint, isAdmin, participantSummaries, readiness, signIn, signOut, testModel, type Check, type ParticipantSummary } from "~/.server/admin";
import { DEFAULT_CONSENT, readConsent, writeConsent } from "~/.server/consent";
import { deleteParticipantData } from "~/.server/data";
import { readFreeze, writeFreeze } from "~/.server/protocol";
import { addParticipants, CODE_RE, removeParticipant, withdrawParticipant } from "~/.server/roster";
import { endSessionsFor } from "~/.server/sessions";
import { cleanPlan, EXAMPLE_PLAN, readStudy, resetProgress, writePlan, type StudyPart } from "~/.server/study";
import type { Level } from "~/lib/types";
import type { Route } from "./+types/admin";

const CONDITION: Record<string, string> = { guided: "Structured", off: "Regular", light: "Light" };

export function meta({}: Route.MetaArgs) {
  return [{ title: "VibeLearner · Researcher" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const none = { rows: [] as ParticipantSummary[], plan: [] as StudyPart[], endUrl: "", checks: [] as Check[], consent: { text: "", custom: false, version: "" }, frozen: false };
  if (!adminPassword()) return data({ state: "off" as const, ...none });
  if (!(await isAdmin(request))) return data({ state: "login" as const, ...none });
  const study = readStudy();
  const rows = await participantSummaries();
  const consent = readConsent();
  return data({
    state: "ok" as const, rows, plan: study.parts, endUrl: study.endUrl, checks: await readiness(rows),
    consent: { text: consent.text, custom: consent.custom, version: consent.version }, frozen: !!readFreeze(),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  // A button can name its own intent; it comes after the form's hidden one, so the last value wins.
  const intent = String(form.getAll("intent").pop() ?? "");
  if (intent === "login") {
    const res = await signIn(String(form.get("password") ?? ""));
    return "error" in res ? data({ error: res.error }, { status: 401 }) : redirect("/admin", { headers: { "Set-Cookie": res.setCookie } });
  }
  if (!(await isAdmin(request))) return data({ error: "Sign in first." }, { status: 401 });
  if (intent === "logout") return redirect("/admin", { headers: { "Set-Cookie": await signOut() } });
  if (intent === "add") {
    const codes = String(form.get("codes") ?? "").split(/[\s,;]+/).filter(Boolean);
    const level = String(form.get("level") ?? "random");
    if (!codes.length) return data({ error: "Type at least one participant code." }, { status: 400 });
    if (!["guided", "off", "light", "random"].includes(level)) return data({ error: "Unknown condition." }, { status: 400 });
    const { added, skipped } = addParticipants(codes, level as Level | "random");
    const parts = [];
    if (added.length) parts.push(`Added ${added.map((a) => `${a.code} (${CONDITION[a.level]})`).join(", ")}.`);
    if (skipped.length) parts.push(`Skipped ${skipped.join(", ")}: already on the list, or not 2-32 letters, digits, - or _.`);
    return data(added.length ? { notice: parts.join(" ") } : { error: parts.join(" ") });
  }
  if (intent === "remove") {
    const code = String(form.get("code") ?? "");
    return removeParticipant(code)
      ? data({ notice: `${code} is off the list. Their log and files were kept.` })
      : data({ error: `${code} isn't on the list.` }, { status: 404 });
  }
  if (intent === "withdraw") {
    // A participant asked for their data to be taken out (they can, up to 14 days after their session).
    const code = String(form.get("code") ?? "");
    if (!CODE_RE.test(code)) return data({ error: "Not a participant code." }, { status: 400 });
    // A tab they left open stops recording before anything is deleted.
    await endSessionsFor(code);
    const removed = await deleteParticipantData(code);
    const listed = withdrawParticipant(code);
    return data({
      notice: `${code} is withdrawn. ${removed.length ? `Deleted their ${removed.join(", ")}.` : "They had no data on this server."}`
        + (listed ? " The code stays on the list as withdrawn, so it can't be used again." : "")
        + " Remember their quiz and questionnaire answers in Qualtrics.",
    });
  }
  if (intent === "consent" || intent === "consentDefault") {
    writeConsent(intent === "consent" ? String(form.get("consentText") ?? "") : "");
    const now = readConsent();
    return data({ consentNotice: now.custom ? `Saved your wording (version ${now.version}). Participants see it from their next sign-in.` : `Using the built-in text (version ${now.version}).` });
  }
  if (intent === "freeze") {
    const fp = currentFingerprint();
    writeFreeze({ hash: fp.hash, at: new Date().toISOString(), details: fp.details });
    return data({ readyNotice: `Frozen as ${fp.hash}. A change to the model, prompts, settings or tasks will now be flagged here.` });
  }
  if (intent === "unfreeze") {
    writeFreeze(undefined);
    return data({ readyNotice: "Not frozen any more." });
  }
  if (intent === "testModel") {
    const res = await testModel();
    return data(res.ok ? { readyNotice: res.message } : { readyError: res.message });
  }
  if (intent === "reset") {
    const code = String(form.get("code") ?? "");
    await endSessionsFor(code);
    resetProgress(code);
    return data({ notice: `${code} will start the study plan from the beginning next time they sign in. Their log and files were kept.` });
  }
  if (intent === "example") {
    const now = readStudy();
    // Keep quiz links that were already pasted in for the same part.
    writePlan(EXAMPLE_PLAN.map((p, i) => ({ ...p, preUrl: now.parts[i]?.preUrl ?? "", postUrl: now.parts[i]?.postUrl ?? "" })), now.endUrl);
    return data({ planNotice: "Loaded the Loops and Lists plan (two parts, about 12 minutes each). Paste your quiz links in and save." });
  }
  if (intent === "plan") {
    const get = (name: string) => form.getAll(name).map(String);
    const [concepts, pre, post, tasks, minutes] = [get("concept"), get("preUrl"), get("postUrl"), get("tasks"), get("minutes")];
    const typed = concepts.map((concept, i) => ({ concept, preUrl: pre[i] ?? "", postUrl: post[i] ?? "", tasks: (tasks[i] ?? "").split(/\r?\n/), minutes: minutes[i] }));
    const parts = cleanPlan(typed);
    writePlan(parts, String(form.get("endUrl") ?? ""));
    const badLinks = typed.some((t, i) => [t.preUrl, t.postUrl].some((u) => u.trim() && !parts.some((p) => p.preUrl === u.trim() || p.postUrl === u.trim())));
    return data({
      planNotice: (parts.length ? `Saved: ${parts.length} part${parts.length > 1 ? "s" : ""} (${parts.map((p) => `${p.concept}, ${p.tasks.length} question${p.tasks.length > 1 ? "s" : ""}`).join("; ")}).` : "Saved: no study plan. Research sessions are one open conversation.")
        + (badLinks ? " A quiz link that didn't start with http:// or https:// was left out." : ""),
    });
  }
  return data({ error: "Unknown action." }, { status: 400 });
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const frac = (a: number, b: number) => (b ? `${a}/${b}` : "—");

export default function Admin({ loaderData, actionData }: Route.ComponentProps) {
  const { state, rows, plan, endUrl, checks, consent, frozen } = loaderData;
  const busy = useNavigation().state !== "idle";
  const msg = actionData as { error?: string; notice?: string; planNotice?: string; consentNotice?: string; readyNotice?: string; readyError?: string } | undefined;
  const hasPlan = plan.length > 0;
  // With a plan, a participant's condition is the one their first part uses; later parts switch.
  const cond = (lv: string) => (hasPlan ? `${CONDITION[lv]} first` : CONDITION[lv]);

  if (state === "off") {
    return (
      <div className="start-shell">
        <main className="center-card">
          <h1>Researcher page</h1>
          <p className="muted">
            This page is switched off. To turn it on, start the server with an admin password in the <code>VL_ADMIN_PASSWORD</code> environment
            variable, then reload.
          </p>
          <a className="btn secondary" href="/">Back to VibeLearner</a>
        </main>
      </div>
    );
  }

  if (state === "login") {
    return (
      <div className="start-shell">
        <main className="center-card">
          <header className="start-header">
            <span className="brandmark lg" aria-hidden>V</span>
            <h1>Researcher sign-in</h1>
            <p className="muted">For the people running the study. Participants don't need this page.</p>
          </header>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="login" />
            <label className="field">Admin password
              <input type="password" name="password" autoComplete="current-password" autoFocus required />
            </label>
            {msg?.error && <p className="alert" role="alert">{msg.error}</p>}
            <button className="btn wide" disabled={busy}>Sign in</button>
          </Form>
        </main>
      </div>
    );
  }

  const listed = rows.filter((r) => r.assigned && !r.withdrawn);
  const problems = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const count = (lv: string) => listed.filter((r) => r.assigned === lv).length;
  const started = rows.filter((r) => r.sessions > 0).length;
  return (
    <div className="adminpage">
      <header className="adminhead">
        <span className="brand"><span className="brandmark" aria-hidden>V</span>VibeLearner <span className="muted">· Researcher</span></span>
        <div className="grow" />
        <a className="btn ghost sm" href="/study" target="_blank" rel="noreferrer">Open the participant sign-in</a>
        <Form method="post"><input type="hidden" name="intent" value="logout" /><button className="btn ghost sm">Sign out</button></Form>
      </header>

      <section className="statrow" aria-label="Study overview">
        <div className="stat"><span>On the list</span><b>{listed.length}</b></div>
        <div className="stat"><span>{cond("guided")}</span><b>{count("guided")}</b></div>
        <div className="stat"><span>{cond("off")}</span><b>{count("off")}</b></div>
        <div className="stat"><span>Have started</span><b>{started}</b></div>
      </section>

      <section className="admincard">
        <h2>Ready for a session?</h2>
        <p className="hint">
          {problems
            ? `${problems} thing${problems === 1 ? "" : "s"} to fix before a participant sits down${warnings ? `, and ${warnings} to look at` : ""}.`
            : warnings ? `Nothing is blocking a session. ${warnings} thing${warnings === 1 ? "" : "s"} to look at first.` : "Everything the proposal asks for is in place."}
        </p>
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.label} className={c.status}>
              <span className="mark" aria-hidden>{c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "✕"}</span>
              <span><b>{c.label}</b><span className="sr-only">{c.status === "ok" ? " (ready)" : c.status === "warn" ? " (check this)" : " (needs fixing)"}</span><span className="why">{c.detail}</span></span>
            </li>
          ))}
        </ul>
        <Form method="post" className="savebar">
          <button className="btn secondary sm" name="intent" value="testModel" disabled={busy}>Test the model</button>
          {plan.length > 0 && (frozen
            ? <button className="btn ghost sm" name="intent" value="unfreeze" disabled={busy}>Unfreeze the configuration</button>
            : <button className="btn secondary sm" name="intent" value="freeze" disabled={busy}>Freeze this configuration</button>)}
          {busy && <span className="hint">Working…</span>}
        </Form>
        {msg?.readyNotice && <p className="notice" role="status">{msg.readyNotice}</p>}
        {msg?.readyError && <p className="alert" role="alert">{msg.readyError}</p>}
      </section>

      <section className="admincard">
        <h2>Study plan</h2>
        <p className="hint">
          Each part teaches one concept through a set of questions. A participant takes the quiz before a part (if it has a link), works through the
          questions with the AI, then takes the quiz after it. Part 1 uses the participant's own condition and each later part switches to the other
          one, so everyone works once with structured vibe coding and once with regular AI. Leave every part empty for no plan.
        </p>
        <Form method="post" className="stack">
          <input type="hidden" name="intent" value="plan" />
          {[...plan, ...Array.from({ length: Math.max(1, 2 - plan.length) }, () => ({ concept: "", tasks: [] as string[], preUrl: "", postUrl: "", minutes: 0 }))].map((p, i) => (
            <fieldset className="partbox" key={`${i}:${plan.length}:${p.concept}:${p.tasks.length}`}>
              <legend>{i < plan.length ? `Part ${i + 1}` : `Part ${i + 1} (new)`}</legend>
              <div className="conceptrow">
                <label className="field grow">Concept
                  <input type="text" name="concept" defaultValue={p.concept} placeholder="e.g. Loops" maxLength={80} autoComplete="off" />
                </label>
                <label className="field">Suggested minutes
                  <input type="number" name="minutes" defaultValue={p.minutes || ""} min={0} max={180} placeholder="none" />
                </label>
              </div>
              <div className="grid2">
                <label className="field">Quiz before <span className="muted">(link, optional)</span>
                  <input type="text" name="preUrl" defaultValue={p.preUrl} placeholder="https://…qualtrics.com/jfe/form/…" autoComplete="off" spellCheck={false} />
                </label>
                <label className="field">Quiz after <span className="muted">(link, optional)</span>
                  <input type="text" name="postUrl" defaultValue={p.postUrl} placeholder="https://…qualtrics.com/jfe/form/…" autoComplete="off" spellCheck={false} />
                </label>
              </div>
              <label className="field">Questions <span className="muted">(one per line, shown one at a time)</span>
                <textarea name="tasks" rows={4} defaultValue={p.tasks.join("\n")} placeholder={"Write a program that prints the numbers 1 to 10.\nWrite a program that adds up the even numbers from 0 to 100."} />
              </label>
            </fieldset>
          ))}
          <label className="field">Closing questionnaire <span className="muted">(link, optional: shown after the last part)</span>
            <input type="text" name="endUrl" defaultValue={endUrl} placeholder="https://…qualtrics.com/jfe/form/…" autoComplete="off" spellCheck={false} />
          </label>
          <div className="savebar">
            <button className="btn" disabled={busy}>Save plan</button>
            <button className="btn secondary" name="intent" value="example" formNoValidate disabled={busy}
              onClick={(e) => { if (plan.length && !confirm("Replace the questions in the plan with the Loops and Lists plan? Quiz links are kept.")) e.preventDefault(); }}>
              Load the Loops and Lists plan
            </button>
            <span className="hint">Quiz links get <code>?pid=CODE&amp;part=1&amp;when=pre</code> added, so the survey can record who answered. Suggested minutes show the participant a clock; nothing is cut off. Changing the plan affects participants who are part-way through.</span>
          </div>
        </Form>
        {msg?.planNotice && <p className="notice" role="status">{msg.planNotice}</p>}
      </section>

      <section className="admincard">
        <h2>Consent form</h2>
        <p className="hint">
          Participants read this and tick a box before they can sign in. {consent.custom
            ? "This is your own wording."
            : "This is a summary written from the proposal: replace it with the wording the ethics board approved."} Each consent is logged with the
          version of the text that was on screen (now <code>{consent.version}</code>).
        </p>
        <details className="consentedit">
          <summary>Read or change the text</summary>
          <Form method="post" className="stack" key={consent.version}>
            <label className="field">Text <span className="muted">(a line starting with ## is a heading, a line starting with - is a bullet, **bold**)</span>
              <textarea name="consentText" rows={18} defaultValue={consent.text} spellCheck />
            </label>
            <div className="savebar">
              <button className="btn" name="intent" value="consent" disabled={busy}>Save the text</button>
              {consent.custom && (
                <button className="btn secondary" name="intent" value="consentDefault" formNoValidate disabled={busy}
                  onClick={(e) => { if (!confirm("Replace your wording with the built-in text?")) e.preventDefault(); }}>
                  Go back to the built-in text
                </button>
              )}
              <a className="btn ghost" href="/study" target="_blank" rel="noreferrer">See it as a participant</a>
            </div>
          </Form>
        </details>
        {msg?.consentNotice && <p className="notice" role="status">{msg.consentNotice}</p>}
      </section>

      <section className="admincard">
        <h2>Add participants</h2>
        <p className="hint">
          {listed.length
            ? "Only codes on this list can start a research session, and each one gets the condition shown here."
            : "The list is empty, so any participant code is accepted and the condition comes from the server's settings. Add a code to switch to list-only sign-in."}
        </p>
        <Form method="post" className="addrow" key={msg?.notice}>
          <input type="hidden" name="intent" value="add" />
          <label className="field grow">Codes <span className="muted">(separate several with spaces or commas)</span>
            <input type="text" name="codes" placeholder="P001 P002 P003" autoComplete="off" spellCheck={false} required />
          </label>
          <label className="field">{hasPlan ? "Order" : "Condition"}
            <select name="level" defaultValue="random">
              <option value="random">Random (keeps groups even)</option>
              <option value="guided">{hasPlan ? "Structured first" : "Structured"}</option>
              <option value="off">{hasPlan ? "Regular first" : "Regular vibe coding"}</option>
              {!hasPlan && <option value="light">Light</option>}
            </select>
          </label>
          <button className="btn" disabled={busy}>Add</button>
        </Form>
        {msg?.notice && <p className="notice" role="status">{msg.notice}</p>}
        {msg?.error && <p className="alert" role="alert">{msg.error}</p>}
      </section>

      <section className="admincard">
        <h2>Participants</h2>
        {rows.length === 0 ? (
          <p className="hint">No participants yet. Add codes above, or wait for someone to start a research session.</p>
        ) : (
          <div className="tablewrap">
            <table className="ptable">
              <thead>
                <tr>
                  <th>Code</th><th>{hasPlan ? "Order" : "Condition"}</th>{hasPlan && <th>Progress</th>}<th>Last active</th>
                  <th className="num" title="Minutes with activity; gaps over five minutes are not counted">Active min</th>
                  <th className="num" title="Ideas explained without help / with help / skipped">Ideas</th>
                  <th className="num" title="Changes accepted / rejected">Changes</th>
                  <th className="num" title="Predictions right / made">Predict</th>
                  <th className="num" title="Questions right / answered">Questions</th>
                  <th className="num" title="Modify challenges done / given">Modify</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code}>
                    <td><code>{r.code}</code></td>
                    <td>
                      {r.assigned ? cond(r.assigned) : <span className="warn" title="This code has a log but isn't on the list">Not on the list</span>}
                      {!hasPlan && r.conditions.length > 1 && <span className="warn" title={`Logged under: ${r.conditions.join(", ")}`}> · mixed</span>}
                    </td>
                    {hasPlan && <td>{r.withdrawn ? <span className="warn">Withdrawn {r.withdrawn.slice(0, 10)}</span> : r.progress ?? "Not started"}</td>}
                    <td>{when(r.last)}</td>
                    <td className="num">{r.sessions ? Math.round(r.activeSec / 60) : "—"}</td>
                    <td className="num">{r.ideasUnaided + r.ideasScaffolded + r.ideasSkipped ? `${r.ideasUnaided}/${r.ideasScaffolded}/${r.ideasSkipped}` : "—"}</td>
                    <td className="num">{r.accepted + r.rejected ? `${r.accepted}/${r.rejected}` : "—"}</td>
                    <td className="num">{frac(r.predictRight, r.predictTotal)}</td>
                    <td className="num">{frac(r.questionsRight, r.questionsTotal)}</td>
                    <td className="num">{frac(r.modifyDone, r.modifyGiven)}</td>
                    <td className="actcell"><div className="rowacts">
                      {r.events > 0 && <a className="btn secondary sm" href={`/admin/chat/${encodeURIComponent(r.code)}`} title="Everything they typed and what the AI answered, step by step">Conversation</a>}
                      {r.events > 0 && <a className="btn ghost sm" href={`/admin/log/${encodeURIComponent(r.code)}`} download title="Their raw log (JSONL)">Log</a>}
                      {r.events > 0 && <a className="btn ghost sm" href={`/admin/data/${encodeURIComponent(r.code)}`} download title="Their log, progress and project files in one .zip">Files</a>}
                      {r.events === 0 && <span className="hint nodata">{r.withdrawn ? "Data deleted" : "No data yet"}</span>}
                      {/* The rarer actions open below the row's buttons, so the table stays narrow. */}
                      <details className="rowmore">
                        <summary className="btn ghost sm">More</summary>
                        <div className="rowmenu">
                          {r.progress && (
                            <Form method="post" onSubmit={(e) => { if (!confirm(`Send ${r.code} back to the start of the study plan? Their log and files are kept.`)) e.preventDefault(); }}>
                              <input type="hidden" name="intent" value="reset" /><input type="hidden" name="code" value={r.code} />
                              <button className="btn ghost sm" disabled={busy} title="Back to the start of the plan; log and files are kept">Restart</button>
                            </Form>
                          )}
                          {!r.withdrawn && (r.events > 0 || r.progress) && (
                            <Form method="post" onSubmit={(e) => { if (!confirm(`Withdraw ${r.code}? This deletes their log, their files and their place in the study for good. It can't be undone.`)) e.preventDefault(); }}>
                              <input type="hidden" name="intent" value="withdraw" /><input type="hidden" name="code" value={r.code} />
                              <button className="btn danger sm" disabled={busy} title="For a participant who asks for their data to be removed: deletes it">Withdraw</button>
                            </Form>
                          )}
                          {r.assigned && (
                            <Form method="post" onSubmit={(e) => { if (!confirm(`Take ${r.code} off the list? Their log and files are kept.`)) e.preventDefault(); }}>
                              <input type="hidden" name="intent" value="remove" /><input type="hidden" name="code" value={r.code} />
                              <button className="btn danger sm" disabled={busy} title="Takes the code off the list; log and files are kept">Remove</button>
                            </Form>
                          )}
                        </div>
                      </details>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">
          Ideas: explained unaided / with the tutor's help / skipped. Changes: accepted / rejected. Hover a column heading for what it counts.
          Conversation shows everything a participant typed and what the AI answered, with each step in between (and why a step was skipped). Under
          More: Restart sends a participant back to the start of the plan, Withdraw deletes their data, Remove takes the code off the list.
        </p>
      </section>

      <section className="admincard">
        <h2>Data</h2>
        <p className="hint">
          Each participant's data is kept under their own code: one log, one progress file and one folder of project files for each part. Nothing
          here holds a name.
        </p>
        <ul className="downloads">
          <li>
            <a className="btn secondary sm" href="/admin/export.csv" download>Summary (CSV)</a>
            <span className="hint">One line per participant and part, with the mode and every measure taken from the log: time, tasks reached, what the participant chose to do, and how the guided steps went.</span>
          </li>
          <li>
            <a className="btn secondary sm" href="/admin/requests.csv" download>Requests to score (CSV)</a>
            <span className="hint">The first request each participant typed for each task, in mixed order, without the participant or the mode. Score input, output and steps in the empty columns.</span>
          </li>
          <li>
            <a className="btn ghost sm" href="/admin/requests-key.csv" download>Scoring key (CSV)</a>
            <span className="hint">Which participant, part and mode each request belongs to. Open it only after scoring.</span>
          </li>
          <li>
            <a className="btn ghost sm" href="/admin/data.zip" download>Everything (.zip)</a>
            <span className="hint">All logs, project files, the participant list, the plan and the consent text, for moving to encrypted UBC storage.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
