import { lazy, Suspense, useEffect, useState } from "react";
import { action, post } from "~/lib/api";
import { pendingChanges } from "~/lib/flow";
import type { EditorView, VibeView } from "~/lib/types";
import { Icon } from "./Icon";

// Monaco only runs in the browser.
const CodeEditor = lazy(() => import("./CodeEditor.client"));

const LANGUAGES: Record<string, string> = { py: "Python", js: "JavaScript", ts: "TypeScript", json: "JSON", html: "HTML", css: "CSS", md: "Markdown", txt: "Text" };
const extOf = (path?: string) => (path?.includes(".") ? path.split(".").pop()!.toLowerCase() : "");
const baseName = (p: string) => p.split("/").pop() ?? p;

/**
 * Left column: the code. Files as tabs, with the code's status where the code is (new code is "not saved until
 * you accept it", and Compare shows what changes); the editor; and under it ▶ Run, the program's input and
 * what it printed. Accepting and rejecting happen in the card beside it, next to the walkthrough.
 */
export function EditorPane({ editor, view }: { editor: EditorView; view: VibeView }) {
  const [mounted, setMounted] = useState(false);
  const [stdin, setStdin] = useState("");
  useEffect(() => setMounted(true), []);

  const pending = pendingChanges(view);
  const pendingPaths = new Set(pending.map((c) => c.path));
  const shown = editor.mode === "proposed" || editor.mode === "diff" ? pending.find((c) => c.path === editor.path) : undefined;
  // A proposed new file isn't in the file list until it is accepted, but it has a tab while it is on screen.
  const tabs = editor.mode !== "none" && editor.path && !editor.files.includes(editor.path) ? [...editor.files, editor.path] : editor.files;
  // Two files with the same name in different folders show their folder too.
  const names = new Map<string, number>();
  tabs.forEach((p) => names.set(baseName(p), (names.get(baseName(p)) ?? 0) + 1));
  const label = (p: string) => (names.get(baseName(p))! > 1 ? p : baseName(p));

  return (
    <section className="editorpane" aria-label="Code">
      <div className="tabs">
        <div className="tablist" role="tablist" aria-label="Your files">
          {tabs.length === 0 && <span className="tabs-empty">No files yet</span>}
          {tabs.map((p) => {
            const on = editor.mode !== "none" && editor.path === p;
            return (
              <button key={p} role="tab" aria-selected={on} className={`tab ${on ? "on" : ""}`} title={p}
                onClick={() => { if (!on && editor.files.includes(p)) post({ type: "open", path: p }); }}>
                {extOf(p) && <span className="ext" aria-hidden>{extOf(p).slice(0, 4)}</span>}
                <span className="fname">{label(p)}</span>
                {pendingPaths.has(p) && <span className="tabdot" title="New code is waiting for you to accept or reject it" />}
              </button>
            );
          })}
        </div>
        <div className="tabtools">
          {editor.mode === "proposed" && <span className="newbadge">New code · not saved until you accept it</span>}
          {editor.mode === "diff" && <span className="newbadge">Comparing your file (left) with the new code (right)</span>}
          {editor.mode === "file" && <span className="edstate">{editor.readOnly ? "read-only" : "saves automatically"}</span>}
          {editor.mode === "diff"
            ? <button className="btn ghost sm" onClick={() => post({ type: "closeDiff" })}><Icon name="close" size={12} /> Close</button>
            : shown && <button className="btn ghost sm" disabled={view.busy} onClick={() => action("viewDiff", shown.id)}><Icon name="diff" size={12} /> Compare</button>}
          <button className="btn ghost sm" disabled={!view.ctx.selection || !view.inputEnabled} onClick={() => action("explainSelection")}
            title={view.ctx.selection ? `Ask the AI to explain ${view.ctx.selection}` : "Select some code first"}>Explain selection</button>
        </div>
      </div>

      <div className="edbody">
        {editor.mode === "none" ? (
          <div className="edempty hint">
            <span className="paper" aria-hidden>&lt;/&gt;</span>
            <span className="title">Your code will appear here</span>
            <p>Ask the AI for a program on the right. You'll see new code here before anything is saved.</p>
          </div>
        ) : mounted ? (
          <Suspense fallback={<div className="edempty hint">Loading the editor…</div>}>
            <CodeEditor editor={editor}
              onSave={(path, content) => post({ type: "save", path, content })}
              onSelect={(path, start, end) => post({ type: "select", path, start, end })} />
          </Suspense>
        ) : (
          <pre className="edfallback"><code>{editor.content}</code></pre>
        )}
      </div>

      <RunPanel view={view} stdin={stdin} setStdin={setStdin} />
    </section>
  );
}

/** ▶ Run, the program's input, and what the last run printed, right under the code that produced it. */
function RunPanel({ view, stdin, setStdin }: { view: VibeView; stdin: string; setStdin: (s: string) => void }) {
  const run = view.lastRun;
  // The crash's "Explain this error" button, while it is still offered in the conversation.
  const explain = run?.errorIdx !== undefined && view.messages.some((m) => m.buttons?.some((b) => b.cmd === "explainError" && b.arg === String(run.errorIdx)));
  const time = run ? new Date(run.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const lang = LANGUAGES[extOf(run?.path)];
  return (
    <section className="runpanel" aria-label="Run the program">
      <div className="runbar">
        <button className="btn sm runbtn" disabled={!view.ctx.active || view.busy} title={view.ctx.active ? `Run ${view.ctx.active}` : "Open a .py or .js file first"}
          onClick={() => action("runFile", stdin)}><Icon name="play" size={12} /> Run</button>
        <input className="stdin" type="text" value={stdin} onChange={(e) => setStdin(e.target.value.replace(/\\n/g, "\n"))}
          placeholder="Program input (optional)" title="What the program reads with input(): separate values with \n" aria-label="Program input" />
        <span className="outmeta">
          <Icon name="terminal" size={12} /> Output
          {run && <span className="muted"> · {run.path}{lang ? ` (${lang})` : ""} · {time}</span>}
          {run?.stderr && <span className="outbad">crashed</span>}
        </span>
      </div>
      <div className="outbody" aria-live="polite">
        {!run ? <span className="hint">Nothing run yet.</span> : (
          <>
            {run.input && <div className="outin"><span className="muted">input:</span> {run.input.trim().replace(/\n/g, " ⏎ ")}</div>}
            {run.note ? <p className="outnote">{run.note}</p> : <pre className="outtext">{run.stdout || "(nothing printed)"}</pre>}
            {run.stderr && <pre className="outtext err">{run.stderr}</pre>}
            {explain && <button className="btn sm" disabled={view.busy || !view.inputEnabled} onClick={() => action("explainError", String(run.errorIdx))}>Explain this error</button>}
          </>
        )}
      </div>
    </section>
  );
}
