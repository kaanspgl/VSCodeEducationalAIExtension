import { useEffect, useState } from "react";
import type { ModelSettings } from "~/lib/types";
import { Icon } from "./Icon";

const OTHER = "__other__";

/** Start screen: which model VibeLearner uses, and API keys for online providers. Only shown on the computer running the server. */
export function ModelPicker() {
  const [s, setS] = useState<ModelSettings>({ available: false });
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [typing, setTyping] = useState(false);
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();

  const choose = (id: string, from: ModelSettings = s) => {
    if (!from.available) return;
    setProvider(id);
    setModel(from.providers.find((p) => p.id === id)?.model ?? "");
    setTyping(false);
    setKey("");
  };
  const load = () =>
    fetch("/api/settings").then((r) => r.json()).then((d: ModelSettings) => {
      setS(d);
      if (d.available) choose(d.provider, d);
    }, () => { /* server unreachable: keep the picker hidden */ });
  useEffect(() => { load(); }, []);

  if (!s.available) return null;
  const p = s.providers.find((x) => x.id === provider) ?? s.providers[0];
  const saved = s.providers.find((x) => x.id === s.provider);
  const options = [...new Set([model, ...p.suggestions].filter(Boolean))];

  const save = async () => {
    setStatus(undefined);
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: p.id, model, key }) }).catch(() => undefined);
    const res = await r?.json().catch(() => undefined);
    if (!r?.ok) return setStatus({ ok: false, text: res?.error || "Couldn't save the settings." });
    setStatus({ ok: true, text: p.needsKey && !p.keyHint && !key.trim() ? "Saved. Add a key before you start." : "Saved. Press Start to use it." });
    load();
  };

  return (
    <details className="research">
      <summary><span className="chev" aria-hidden><Icon name="chevron" size={12} /></span>Model <span className="muted sumnote">{saved?.model} · {saved?.label}</span></summary>
      <div className="grid2">
      <label className="field">Provider
        <select value={p.id} onChange={(e) => choose(e.target.value)}>
          {s.providers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label className="field">Model
        {p.suggestions.length > 0 && !typing ? (
          <select value={model} onChange={(e) => (e.target.value === OTHER ? setTyping(true) : setModel(e.target.value))}>
            {options.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value={OTHER}>Another model…</option>
          </select>
        ) : (
          <input type="text" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} autoComplete="off" placeholder="Model name" />
        )}
      </label>
      </div>
      {p.needsKey && (
        <label className="field">API key
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false}
            placeholder={p.keyHint ? `Saved key ends in ${p.keyHint}. Paste a new one to replace it.` : "Paste your key"} />
        </label>
      )}
      {p.note && <p className="hint">{p.note}</p>}
      {p.keyUrl && (
        <p className="hint">
          Get a key at <a href={p.keyUrl} target="_blank" rel="noreferrer">{new URL(p.keyUrl).host}</a>. It's saved in vibelearner.config.json on
          this computer and never sent back to the browser.
        </p>
      )}
      {p.env.length > 0 && <p className="hint">Set by environment variables, which win over what you save here: {p.env.join(", ")}.</p>}
      <div className="savebar">
        <button className="btn secondary sm" onClick={save} disabled={!model.trim()}>Save</button>
        {status && <span className={`hint ${status.ok ? "" : "bad"}`} role="status">{status.text}</span>}
      </div>
    </details>
  );
}
