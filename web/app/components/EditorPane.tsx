import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { action, post } from "~/lib/api";
import { pendingChanges } from "~/lib/flow";
import { md } from "~/lib/md";
import type { EditorView, VibeView } from "~/lib/types";
import { Icon } from "./Icon";

// Monaco only runs in the browser.
const CodeEditor = lazy(() => import("./CodeEditor.client"));

const LANGUAGES: Record<string, string> = { py: "Python", js: "JavaScript", ts: "TypeScript", json: "JSON", html: "HTML", css: "CSS", md: "Markdown", txt: "Text" };
const extOf = (path?: string) => (path?.includes(".") ? path.split(".").pop()!.toLowerCase() : "");
const baseName = (p: string) => p.split("/").pop() ?? p;

/**
 * Middle column: the code. Files as tabs, ▶ Run, the bar to accept or reject new code, the editor itself, and under
 * it whatever is about the code right now (the walkthrough, a question), then the program's output.
 */
/** `pointAt`: the guide is pointing at the Accept / Reject bar, so it is highlighted. */
export function EditorPane({ editor, view, pointAt }: { editor: EditorView; view: VibeView; pointAt?: boolean }) {
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
  // One primary action at a time: while the walkthrough or a question is open, that box has it, not Accept.
  const boxOpen = !!(view.tour || view.quiz);

  return (
    <section className="editorpane" aria-label="Code">
      <div className="tabs" role="tablist" aria-label="Your files">
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

      <div className="edbar">
        <span className="edtitle">
          {editor.mode === "none" ? <span className="muted">No file open</span>
            : editor.mode === "diff" ? editor.diff?.title
            : <>{editor.path}<span className="edstate">{editor.mode === "proposed" ? "" : editor.readOnly ? "read-only" : "saves automatically"}</span></>}
        </span>
        <div className="grow" />
        <button className="btn ghost sm" disabled={!view.ctx.selection || !view.inputEnabled} onClick={() => action("explainSelection")}
          title={view.ctx.selection ? `Ask the AI to explain ${view.ctx.selection}` : "Select some code in the editor first"}>Explain selection</button>
        <input className="stdin" type="text" value={stdin} onChange={(e) => setStdin(e.target.value.replace(/\\n/g, "\n"))}
          placeholder="Program input (optional)" title="What the program reads with input(): separate values with \n" aria-label="Program input" />
        <button className="btn sm runbtn" disabled={!view.ctx.active || view.busy} title={view.ctx.active ? `Run ${view.ctx.active}` : "Open a .py or .js file first"}
          onClick={() => action("runFile", stdin)}><Icon name="play" size={12} /> Run</button>
      </div>

      {shown && (
        <div className={`proposebar ${pointAt ? "attention" : ""}`} role="region" aria-label="New code">
          <span className="ptext">
            <b>{editor.mode === "diff" ? "Comparing your file with the new code" : shown.isNew ? "New code from the AI" : "A change from the AI"}</b>
            <span className="muted">Not saved until you accept it.</span>
          </span>
          {editor.mode === "diff"
            ? <button className="btn ghost sm" onClick={() => post({ type: "closeDiff" })}><Icon name="close" size={12} /> Close comparison</button>
            : <button className="btn ghost sm" disabled={view.busy} onClick={() => action("viewDiff", shown.id)}><Icon name="diff" size={12} /> Compare</button>}
          <button className="btn danger sm" disabled={view.busy} onClick={() => action("reject", shown.id)}>Reject</button>
          <button className={`btn sm ${boxOpen ? "secondary" : ""}`} disabled={view.busy} onClick={() => action("accept", shown.id)}><Icon name="check" size={12} /> Accept</button>
        </div>
      )}
      {!shown && editor.mode === "diff" && (
        <div className="proposebar quiet"><span className="ptext"><b>{editor.diff?.title}</b></span>
          <button className="btn ghost sm" onClick={() => post({ type: "closeDiff" })}><Icon name="close" size={12} /> Close comparison</button></div>
      )}

      <div className="edbody">
        {editor.mode === "none" ? (
          <div className="edempty hint">
            <span className="paper" aria-hidden>&lt;/&gt;</span>
            <span className="title">Your code will appear here</span>
            <p>Ask the AI for a program in the chat, or open a file above. You'll see new code here before anything is saved.</p>
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

      {view.tour && <TourBox view={view} />}
      {view.quiz && <QuizBox view={view} />}
      <OutputPanel view={view} lang={LANGUAGES[extOf(view.lastRun?.path)]} quiet={boxOpen} />
    </section>
  );
}

/** The walkthrough, right under the lines it highlights. */
function TourBox({ view }: { view: VibeView }) {
  const t = view.tour!;
  return (
    <section className="dockbox tourbox" aria-label="Walkthrough">
      <div className="quiz-head">
        <span className="eyebrow grow">Walkthrough · part {t.index + 1} of {t.total} · {t.start === t.end ? `line ${t.start}` : `lines ${t.start}–${t.end}`}{t.pending ? " (new code)" : ""}</span>
        <button className="linkbtn" disabled={view.busy} onClick={() => action("tourEnd")}>Exit</button>
      </div>
      <div className="tourprog" aria-hidden>
        {Array.from({ length: t.total }, (_, i) => <span key={i} className={i <= t.index ? "on" : ""} />)}
      </div>
      <h3 className="tour-title">{t.title}</h3>
      <div className="tourtext" dangerouslySetInnerHTML={{ __html: md(t.text) }} />
      <div className="cactions">
        <button className="btn secondary sm" disabled={view.busy || t.index === 0} onClick={() => action("tourPrev")}>◀ Back</button>
        {t.index + 1 < t.total
          ? <button className="btn sm" disabled={view.busy} onClick={() => action("tourNext")}>Next ▶</button>
          : <button className="btn sm" disabled={view.busy} onClick={() => action("tourEnd")}>Finish walkthrough</button>}
        <span className="hint"><span className="swatch" aria-hidden />Highlighted in the code above. Questions go in the chat.</span>
      </div>
    </section>
  );
}

function QuizBox({ view }: { view: VibeView }) {
  const q = view.quiz!;
  return (
    <section className="dockbox quizbox" aria-label="Question">
      <div className="quiz-head">
        <span className="eyebrow grow">🔍 {q.label} · question {q.index + 1} of {q.total}</span>
        <button className="linkbtn" disabled={view.busy} onClick={() => action("skipQuiz")}>Skip</button>
      </div>
      <div className="stem" dangerouslySetInnerHTML={{ __html: md(q.stem) }} />
      <div className="choices">
        {q.choices.map((c, i) => (
          <button key={i} className="choice" disabled={view.busy} onClick={() => post({ type: "quizAnswer", choice: i })}><span className="letter">{"ABCD"[i]}</span><span>{c}</span></button>
        ))}
      </div>
    </section>
  );
}

/** What the last ▶ Run printed, next to the button that ran it. Folds away while the walkthrough or a question is open. */
function OutputPanel({ view, lang, quiet }: { view: VibeView; lang?: string; quiet: boolean }) {
  const run = view.lastRun;
  const [open, setOpen] = useState(true);
  const seen = useRef(run?.at);
  // A new run always shows its output.
  useEffect(() => {
    if (run?.at !== seen.current) { seen.current = run?.at; setOpen(true); }
  }, [run?.at]);
  const shown = open && !quiet;
  // The crash's "Explain this error" button, while it is still offered in the conversation.
  const explain = run?.errorIdx !== undefined && view.messages.some((m) => m.buttons?.some((b) => b.cmd === "explainError" && b.arg === String(run.errorIdx)));
  const time = run ? new Date(run.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  return (
    <section className={`output ${shown ? "open" : ""}`} aria-label="Program output">
      <button className="outhead" aria-expanded={shown} onClick={() => setOpen(!shown)}>
        <span className="chev" aria-hidden><Icon name="chevron" size={11} /></span>
        <Icon name="terminal" size={13} /> Output
        {run && <span className="muted">· {run.path}{lang ? ` (${lang})` : ""} · {time}</span>}
        {run?.stderr && <span className="outbad">crashed</span>}
      </button>
      {shown && (
        <div className="outbody">
          {!run ? <p className="hint">Press <b>▶ Run</b> to see what the open program prints.</p> : (
            <>
              {run.input && <div className="outin"><span className="muted">input:</span> {run.input.trim().replace(/\n/g, " ⏎ ")}</div>}
              {run.note ? <p className="outnote">{run.note}</p> : <pre className="outtext">{run.stdout || "(nothing printed)"}</pre>}
              {run.stderr && <pre className="outtext err">{run.stderr}</pre>}
              {explain && <button className="btn sm" disabled={view.busy || !view.inputEnabled} onClick={() => action("explainError", String(run.errorIdx))}>Explain this error</button>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
