import { action } from "~/lib/api";
import { md } from "~/lib/md";
import type { VibeChange, VibeMsg } from "~/lib/types";
import { Icon } from "./Icon";
import { STAGE_ICON } from "./levels";

/**
 * One message, as the card and the history both draw it. `chips` shows each change's learning steps as buttons:
 * only in Light mode, where they are how a step starts (Structured mode runs them by itself, and the track above
 * the card already shows them).
 */
export function Message({ m, busy, primaryAccept, chips }: { m: VibeMsg; busy: boolean; primaryAccept: boolean; chips: boolean }) {
  // ▶ Run's output is under the code; the history keeps a line that opens to show it.
  if (m.look === "output") {
    const [head, ...rest] = m.text.split("\n");
    return (
      <div className="msg system">
        <details className="runline">
          <summary><span className="chev" aria-hidden><Icon name="chevron" size={10} /></span><span dangerouslySetInnerHTML={{ __html: md(head.replace(/:\s*$/, "")) }} /></summary>
          <div dangerouslySetInnerHTML={{ __html: md(rest.join("\n")) }} />
        </details>
      </div>
    );
  }
  const who = m.role === "student" ? "You: " : m.role === "tutor" ? "VibeLearner: " : "";
  return (
    <div className={`msg ${m.role}`}>
      {m.role === "tutor" && <span className="avatar" aria-hidden>V</span>}
      <div className={`bubble ${m.look ?? ""}`} role={m.look === "crash" ? "alert" : undefined}>
        {who && <span className="sr-only">{who}</span>}
        {m.score && <strong className="bigscore" aria-hidden>{m.score}</strong>}
        <div dangerouslySetInnerHTML={{ __html: md(m.text) }} />
        {m.changes && <Changes changes={m.changes} busy={busy} primaryAccept={primaryAccept} chips={chips} />}
        {m.buttons && (
          <div className="cactions">
            {m.buttons.map((b, i) => (
              <button key={i} className={`btn ${b.primary ? "" : "secondary"} sm`} disabled={busy} onClick={() => action(b.cmd, b.arg)}>{b.label}</button>
            ))}
          </div>
        )}
        {m.tip && (
          <details className="tip">
            <summary><span className="chev" aria-hidden><Icon name="chevron" size={12} /></span>💡 Prompt tip <span className="muted">({m.tip.score}/6)</span></summary>
            <div dangerouslySetInnerHTML={{ __html: md(m.tip.text) }} />
            {m.tip.improved && <><div className="hint" style={{ marginTop: 4 }}>A stronger version:</div><div className="improved">{m.tip.improved}</div></>}
          </details>
        )}
      </div>
    </div>
  );
}

const STATE_TEXT: Record<string, string> = { active: "now", done: "✓", skipped: "skipped", na: "—" };

/** Code changes with Compare, Reject and Accept (and the learning steps as buttons in Light mode). */
export function Changes({ changes, busy, primaryAccept, chips }: { changes: VibeChange[]; busy: boolean; primaryAccept: boolean; chips: boolean }) {
  const pending = changes.filter((c) => c.status === "pending");
  // With several pending changes, "Accept all" is the primary action rather than each Accept.
  const acceptCls = primaryAccept && pending.length === 1 ? "btn sm" : "btn secondary sm";
  return (
    <div className="changes">
      {changes.map((c) => (
        <div key={c.id} className={`change ${c.status}`}>
          <div className="cfile">
            <code>{c.path}</code>{c.isNew && <span className="tag">new file</span>}
            {c.status !== "failed" && <span className="diffstat"><span className="plus">+{c.added}</span> <span className="minus">−{c.removed}</span></span>}
            <span className="cbtns">
              {c.status === "pending" ? (
                <>
                  <button className="btn ghost sm" disabled={busy} onClick={() => action("viewDiff", c.id)}>Compare</button>
                  <button className="btn danger sm" disabled={busy} onClick={() => action("reject", c.id)}>Reject</button>
                  <button className={acceptCls} disabled={busy} onClick={() => action("accept", c.id)}>Accept</button>
                </>
              ) : c.status === "accepted" ? <span className="status ok">✓ Saved</span>
                : c.status === "rejected" ? <span className="status muted">Rejected</span>
                : <span className="status warn">Couldn't apply</span>}
            </span>
          </div>
          {c.note && <div className="muted small">{c.note}</div>}
          {chips && c.learn && (
            <div className="learnrow" aria-label={`Learning steps for ${c.path}`}>
              {c.learn.map((s) => {
                const needsAccept = s.stage !== "tour" && c.status !== "accepted";
                const disabled = busy || s.status === "done" || s.status === "na" || s.status === "active" || needsAccept;
                const title = s.status === "na" ? "Not available for this change" : needsAccept ? "Accept the change first" : "";
                const cls = needsAccept && s.status === "todo" ? "locked" : s.status;
                return (
                  <button key={s.stage} className={`stagechip ${cls}`} disabled={disabled} title={title} onClick={() => action("stage", `${c.id}:${s.stage}`)}>
                    <span aria-hidden>{STAGE_ICON[s.stage]}</span> {s.label}{STATE_TEXT[s.status] && <span className="state">{STATE_TEXT[s.status]}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      {pending.length > 1 && <button className={`btn ${primaryAccept ? "" : "secondary"} sm`} disabled={busy} onClick={() => action("acceptAll", pending[0].id)}>Accept all ({pending.length})</button>}
    </div>
  );
}
