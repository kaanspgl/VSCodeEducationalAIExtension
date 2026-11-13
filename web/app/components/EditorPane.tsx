import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { action, post } from "~/lib/api";
import type { EditorView, VibeView } from "~/lib/types";
import { Icon } from "./Icon";

// Monaco only runs in the browser.
const CodeEditor = lazy(() => import("./CodeEditor.client"));

const LANGUAGES: Record<string, string> = { py: "Python", js: "JavaScript", ts: "TypeScript", json: "JSON", html: "HTML", css: "CSS", md: "Markdown", txt: "Text" };
const extOf = (path?: string) => (path?.includes(".") ? path.split(".").pop()!.toLowerCase() : "");

type Row = { path: string; name: string; depth: number; folder: boolean };

/** The file list as rows: each folder once (not clickable), then its files, indented by depth. */
function fileRows(files: string[]): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    parts.slice(0, -1).forEach((name, i) => {
      const p = parts.slice(0, i + 1).join("/");
      if (!seen.has(p)) { seen.add(p); rows.push({ path: p, name, depth: i, folder: true }); }
    });
    rows.push({ path: f, name: parts[parts.length - 1], depth: parts.length - 1, folder: false });
  }
  return rows;
}

/** Left side: the student's files, the code editor (files, proposals, diffs, walkthrough highlights) and ▶ Run. */
export function EditorPane({ editor, view }: { editor: EditorView; view: VibeView }) {
  const [mounted, setMounted] = useState(false);
  const [stdin, setStdin] = useState("");
  useEffect(() => setMounted(true), []);
  const rows = useMemo(() => fileRows(editor.files), [editor.files]);

  return (
    <section className="editorpane">
      <nav className="files" aria-label="Your files">
        <div className="hint files-head">Your files</div>
        {editor.files.length === 0 && <div className="hint">No files yet. Ask VibeLearner to build something.</div>}
        {rows.map((r) => r.folder ? (
          <div key={r.path} className="folder" style={{ paddingLeft: 8 + 12 * r.depth }}><span aria-hidden>📁</span>{r.name}/</div>
        ) : (
          <button key={r.path} className={`file ${editor.mode === "file" && editor.path === r.path ? "open" : ""}`} title={r.path}
            style={{ paddingLeft: 8 + 12 * r.depth }} onClick={() => post({ type: "open", path: r.path })}>
            {extOf(r.name) && <span className="ext" aria-hidden>{extOf(r.name).slice(0, 4)}</span>}
            <span className="fname">{r.name}</span>
          </button>
        ))}
      </nav>
      <div className="editorcol">
        <div className="edbar">
          <span className="edtitle">
            {editor.mode === "diff" ? editor.diff?.title
              : editor.mode === "proposed" ? <>{editor.path}<span className="pill">proposed, not accepted yet</span></>
              : editor.path || <span className="muted">No file open</span>}
          </span>
          {editor.mode === "diff" && <button className="btn secondary sm" onClick={() => post({ type: "closeDiff" })}><Icon name="close" size={12} /> Close diff</button>}
          <div className="grow" />
          <input className="stdin" type="text" value={stdin} onChange={(e) => setStdin(e.target.value.replace(/\\n/g, "\n"))}
            placeholder="Program input (optional)" title="What the program reads with input(): separate values with \n" aria-label="Program input" />
          <button className="btn secondary sm" disabled={!view.ctx.active || view.busy} title={view.ctx.active ? `Run ${view.ctx.active}` : "Open a .py or .js file first"}
            onClick={() => action("runFile", stdin)}><Icon name="play" size={12} /> Run</button>
        </div>
        <div className="edbody">
          {editor.mode === "none" ? (
            <div className="edempty hint">
              <span className="paper" aria-hidden>&lt;/&gt;</span>
              <span className="title">Your code will appear here</span>
              <p>Describe what you want to build in the chat, or open a file on the left. You'll see new code before anything is saved.</p>
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
        <div className="statusbar">
          <span>{editor.mode === "none" ? "Ready" : LANGUAGES[extOf(editor.path)] ?? (extOf(editor.path).toUpperCase() || "Text")}</span>
          <span>
            {editor.mode === "none" ? ""
              : editor.mode === "diff" ? "Comparing with the proposed change"
              : editor.mode === "proposed" ? "Proposed: nothing is saved until you accept"
              : editor.readOnly ? "Read-only" : "Your edits save automatically"}
          </span>
        </div>
      </div>
    </section>
  );
}
