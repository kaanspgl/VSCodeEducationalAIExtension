import Editor, { DiffEditor, loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { useEffect, useRef, useState } from "react";
import type { EditorView } from "~/lib/types";

// Self-hosted Monaco (no CDN), so the platform also works on a closed lab network.
(self as any).MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === "typescript" || label === "javascript" ? new TsWorker() : new EditorWorker()),
};
loader.config({ monaco });

// The page's paper and ink colours (app.css), so the editor doesn't look like a different app.
monaco.editor.defineTheme("vl-light", {
  base: "vs", inherit: true, rules: [],
  colors: {
    "editor.background": "#fefdfb", "editor.foreground": "#1a222b", "editorGutter.background": "#fefdfb",
    "editorLineNumber.foreground": "#8a929a", "editorLineNumber.activeForeground": "#1a222b",
    "editor.selectionBackground": "#b9e3ea", "editor.inactiveSelectionBackground": "#ceeff3",
    "editorIndentGuide.background1": "#ece9e2", "editorWidget.border": "#dbd7cf",
    "diffEditor.insertedTextBackground": "#3f8f5b33", "diffEditor.removedTextBackground": "#c2483b2e",
  },
});
monaco.editor.defineTheme("vl-dark", {
  base: "vs-dark", inherit: true, rules: [],
  colors: {
    "editor.background": "#1e2329", "editor.foreground": "#eae7e2", "editorGutter.background": "#1e2329",
    "editorLineNumber.foreground": "#737b83", "editorLineNumber.activeForeground": "#eae7e2",
    "editor.selectionBackground": "#1f5a63", "editor.inactiveSelectionBackground": "#143c42",
    "editorIndentGuide.background1": "#272c32", "editorWidget.border": "#33393f",
  },
});

/** Shared by the editor and the diff view: roomier lines and the page's monospace font. */
const LOOK = {
  fontSize: 14, lineHeight: 22, padding: { top: 12 }, lineDecorationsWidth: 12, minimap: { enabled: false }, automaticLayout: true,
  fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
};

type Props = {
  editor: EditorView;
  onSave: (path: string, content: string) => void;
  onSelect: (path: string, start?: number, end?: number) => void;
};

export default function CodeEditor(props: Props) {
  const theme = usePrefersDark() ? "vl-dark" : "vl-light";
  const { editor } = props;
  if (editor.mode === "diff" && editor.diff) {
    return (
      <DiffEditor original={editor.diff.original} modified={editor.diff.modified} language={languageOf(editor.path)} theme={theme}
        options={{ ...LOOK, readOnly: true, originalEditable: false, renderSideBySide: true }} />
    );
  }
  // A new editor whenever the server replaces the content (another file, a proposal, an accepted change),
  // so what the student is typing is never overwritten by a stale copy.
  return <FileEditor key={`${editor.mode}:${editor.path}:${editor.version}`} {...props} theme={theme} />;
}

function FileEditor({ editor, onSave, onSelect, theme }: Props & { theme: string }) {
  const path = editor.path ?? "";
  const edRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const pending = useRef<string | undefined>(undefined);
  const saveTimer = useRef<number | undefined>(undefined);
  const selTimer = useRef<number | undefined>(undefined);
  const [ready, setReady] = useState(false);

  const flush = () => {
    window.clearTimeout(saveTimer.current);
    if (pending.current !== undefined) onSave(path, pending.current);
    pending.current = undefined;
  };
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  // Walkthrough: highlight the stop's lines and scroll to them.
  const h = editor.highlight;
  useEffect(() => {
    const ed = edRef.current;
    if (!ed || !decos.current) return;
    decos.current.set(h ? [{ range: new monaco.Range(h.start, 1, h.end, 1), options: { isWholeLine: true, className: "tourline", linesDecorationsClassName: "tourgutter" } }] : []);
    if (h) ed.revealLinesInCenterIfOutsideViewport(h.start, h.end);
  }, [ready, h?.start, h?.end]);

  const onMount: OnMount = (ed) => {
    edRef.current = ed;
    decos.current = ed.createDecorationsCollection();
    if (editor.mode === "file") {
      // A fresh editor has nothing selected (e.g. after a reload), so the server shouldn't think otherwise.
      onSelect(path);
      ed.onDidChangeCursorSelection((e) => {
        window.clearTimeout(selTimer.current);
        selTimer.current = window.setTimeout(() => {
          const s = e.selection;
          if (s.isEmpty()) onSelect(path);
          else onSelect(path, s.startLineNumber, s.endColumn === 1 && s.endLineNumber > s.startLineNumber ? s.endLineNumber - 1 : s.endLineNumber);
        }, 300);
      });
    }
    setReady(true);
  };

  return (
    <Editor defaultValue={editor.content ?? ""} language={languageOf(path)} theme={theme} onMount={onMount}
      onChange={(v) => {
        if (editor.readOnly) return;
        pending.current = v ?? "";
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(flush, 500);
      }}
      options={{ ...LOOK, readOnly: editor.readOnly, scrollBeyondLastLine: false, renderLineHighlight: "none" }} />
  );
}

function languageOf(path?: string): string {
  const ext = path?.split(".").pop()?.toLowerCase() ?? "";
  return ({ py: "python", js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", json: "json", html: "html", css: "css", md: "markdown", java: "java", c: "c", cpp: "cpp", cs: "csharp", go: "go", rb: "ruby", php: "php", sql: "sql", sh: "shell" } as Record<string, string>)[ext] ?? "plaintext";
}

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}
