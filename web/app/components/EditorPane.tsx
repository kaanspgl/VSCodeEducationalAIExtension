import { lazy, Suspense, useEffect, useState } from "react";
import { action, post } from "~/lib/api";
import type { EditorView, VibeView } from "~/lib/types";

// Monaco only runs in the browser.
const CodeEditor = lazy(() => import("./CodeEditor.client"));

/** Left side: the student's files, the code editor (files, proposals, diffs, walkthrough highlights) and ▶ Run. */
export function EditorPane({ editor, view }: { editor: EditorView; view: VibeView }) {
  const [mounted, setMounted] = useState(false);
  const [stdin, setStdin] = useState("");
  useEffect(() => setMounted(true), []);

  const title = editor.mode === "diff" ? editor.diff?.title
    : editor.mode === "proposed" ? `${editor.path} (proposed, not accepted yet)`
    : editor.path;
  return (
    <section className="editorpane">
      <nav className="files" aria-label="Your files">
        <div className="hint files-head">Your files</div>
        {editor.files.length === 0 && <div className="hint">No files yet. Ask VibeLearner to build something.</div>}
        {editor.files.map((f) => (
          <button key={f} className={`file ${editor.mode === "file" && editor.path === f ? "open" : ""}`} title={f}
            style={{ paddingLeft: 8 + 12 * (f.split("/").length - 1) }} onClick={() => post({ type: "open", path: f })}>
            {f.split("/").pop()}
          </button>
        ))}
      </nav>
      <div className="editorcol">
        <div className="edbar">
          <span className="edtitle">{title || "No file open"}</span>
          {editor.mode === "diff" && <button className="btn secondary sm" onClick={() => post({ type: "closeDiff" })}>Close diff</button>}
          <div className="grow" />
          <input className="stdin" type="text" value={stdin} onChange={(e) => setStdin(e.target.value.replace(/\\n/g, "\n"))}
            placeholder="Program input (optional)" title="What the program reads with input(): separate values with \n" aria-label="Program input" />
          <button className="btn sm" disabled={!view.ctx.active || view.busy} title={view.ctx.active ? `Run ${view.ctx.active}` : "Open a .py or .js file first"}
            onClick={() => action("runFile", stdin)}>▶ Run</button>
        </div>
        <div className="edbody">
          {editor.mode === "none" ? (
            <div className="edempty hint">Your code shows up here. Ask VibeLearner to build something, or open a file on the left.</div>
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
      </div>
    </section>
  );
}
