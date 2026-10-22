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

type Props = {
  editor: EditorView;
  onSave: (path: string, content: string) => void;
  onSelect: (path: string, start?: number, end?: number) => void;
};

export default function CodeEditor(props: Props) {
  const theme = usePrefersDark() ? "vs-dark" : "vs";
  const { editor } = props;
  if (editor.mode === "diff" && editor.diff) {
    return (
      <DiffEditor original={editor.diff.original} modified={editor.diff.modified} language={languageOf(editor.path)} theme={theme}
        options={{ readOnly: true, originalEditable: false, renderSideBySide: true, automaticLayout: true, minimap: { enabled: false }, fontSize: 14 }} />
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
      options={{ readOnly: editor.readOnly, minimap: { enabled: false }, fontSize: 14, automaticLayout: true, scrollBeyondLastLine: false, renderLineHighlight: "none" }} />
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
