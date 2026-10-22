/**
 * The project text the model sees each turn: file listing, numbered file contents within a character budget,
 * the active file and the student's selection. No editor dependencies, so the VS Code extension and the web
 * platform give the model exactly the same format.
 */

export type Selection = { path: string; startLine: number; endLine: number; text: string };

/** A project file in priority order; `text` undefined = listed only (not read, or too big). */
export type ContextFile = { path: string; text?: string };

export function formatContext(
  files: ContextFile[],
  maxChars: number,
  opts: { scope?: string; active?: string; selection?: Selection } = {}
): { text: string; included: string[] } {
  const listing: string[] = [];
  const blocks: string[] = [];
  const included: string[] = [];
  let used = 0;

  for (const f of files) {
    if (f.text === undefined) { listing.push(`- ${f.path}`); continue; }
    const lines = f.text.replace(/\r\n/g, '\n').split('\n');
    listing.push(`- ${f.path} (${lines.length} lines)`);

    // Full text for every file that fits the budget (open files first), so edits can quote it exactly.
    const full = numbered(lines);
    if (used + full.length <= maxChars) {
      blocks.push(`=== ${f.path} ===\n${full}`);
      used += full.length;
      included.push(f.path);
    } else {
      const outline = outlineOf(lines);
      if (outline && used + outline.length <= maxChars) {
        blocks.push(`=== ${f.path} (outline only — full text not shown) ===\n${outline}`);
        used += outline.length;
      }
    }
  }

  const parts = [
    opts.scope ? `CURRENT PROJECT FOLDER: ${opts.scope}/ (only files in this folder are shown; create new files inside it)` : '',
    `PROJECT FILES (${files.length}):\n${listing.join('\n') || '(none yet)'}`,
    `FILE CONTENTS (line numbers are for reference only and are NOT part of the file):\n${blocks.join('\n\n') || '(none)'}`,
  ];
  if (opts.active) parts.push(`ACTIVE FILE: ${opts.active}`);
  const sel = opts.selection;
  if (sel) parts.push(`STUDENT SELECTION (${sel.path}, lines ${sel.startLine}-${sel.endLine}):\n${sel.text}`);
  return { text: parts.filter(Boolean).join('\n\n'), included };
}

export function numbered(lines: string[]): string {
  const w = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(w, ' ')}| ${l}`).join('\n');
}

/** Signature-ish lines so the model knows what lives in files it can't see in full. */
function outlineOf(lines: string[]): string {
  const re = /^\s*(def |class |function |export |import |from |const \w+ = (\(|async|function)|public |private |protected |static |interface |type |#include|using |package )/;
  const out: string[] = [];
  lines.forEach((l, i) => { if (re.test(l) && out.length < 40) out.push(`${i + 1}| ${l.slice(0, 140)}`); });
  return out.join('\n');
}
