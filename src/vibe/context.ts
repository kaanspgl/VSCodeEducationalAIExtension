import * as vscode from 'vscode';

export type Selection = { path: string; startLine: number; endLine: number; text: string };

export type ProjectContext = {
  /** Text block given to the model: file listing, file contents (numbered), and selection. */
  text: string;
  /** Contents-only block used for quizzes. */
  files: string[];
  fileCount: number;
  /** Every project path (workspace-relative, POSIX). */
  paths: string[];
  folder?: vscode.Uri;
  active?: string;
  activeContent?: string;
  selection?: Selection;
};

const INCLUDE = '**/*.{py,js,jsx,ts,tsx,java,c,cpp,h,hpp,cs,go,rs,rb,php,html,css,scss,sql,sh,json,md,txt}';
const EXCLUDE = '**/{node_modules,.git,out,dist,build,__pycache__,.venv,venv,.vscode,coverage,.idea}/**';
const MAX_FILE_BYTES = 60_000;
const SKIP_NAMES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.min\.(js|css)$/;

/**
 * Gathers the whole project (within a character budget) so the model can see the entire program.
 * `scope` limits it to one project folder (workspace-relative) when the student started a "new project".
 */
export async function buildContext(maxChars: number, scope?: string): Promise<ProjectContext> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return { text: '(No folder is open, so no project files are visible.)', files: [], fileCount: 0, paths: [] };
  }

  const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, INCLUDE), EXCLUDE, 400);
  const rel = (u: vscode.Uri) => vscode.workspace.asRelativePath(u, false).replace(/\\/g, '/');
  const all = found.filter(u => !SKIP_NAMES.test(rel(u)) && inScope(rel(u), scope));

  const activeEd = vscode.window.activeTextEditor;
  // An open file outside the current project folder is not part of this project.
  const activeUri = activeEd && activeEd.document.uri.scheme === 'file' && inScope(rel(activeEd.document.uri), scope)
    ? activeEd.document.uri : undefined;
  const visible = new Set(vscode.window.visibleTextEditors.map(e => e.document.uri.toString()));
  const openTabs = new Set<string>();
  for (const g of vscode.window.tabGroups.all) {
    for (const t of g.tabs) {
      const input: any = t.input;
      if (input?.uri) openTabs.add(String(input.uri.toString()));
    }
  }
  const priority = (u: vscode.Uri) => {
    const k = u.toString();
    if (activeUri && k === activeUri.toString()) return 0;
    if (visible.has(k)) return 1;
    if (openTabs.has(k)) return 2;
    return 3;
  };
  all.sort((a, b) => priority(a) - priority(b) || rel(a).length - rel(b).length || rel(a).localeCompare(rel(b)));

  const openDocs = new Map(vscode.workspace.textDocuments.map(d => [d.uri.toString(), d]));
  const readText = async (u: vscode.Uri): Promise<string | undefined> => {
    const open = openDocs.get(u.toString());
    if (open) return open.getText(); // includes unsaved edits
    try {
      const bytes = await vscode.workspace.fs.readFile(u);
      if (bytes.length > MAX_FILE_BYTES) return undefined;
      return new TextDecoder().decode(bytes);
    } catch { return undefined; }
  };

  const listing: string[] = [];
  const blocks: string[] = [];
  const included: string[] = [];
  let used = 0;
  let readCount = 0;

  for (const u of all) {
    const path = rel(u);
    const prio = priority(u);
    let text: string | undefined;
    if (prio <= 2 || readCount < 80) { text = await readText(u); readCount++; }
    if (text === undefined) { listing.push(`- ${path}`); continue; }
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    listing.push(`- ${path} (${lines.length} lines)`);

    // Full text for every file that fits the budget (open files first), so edits can quote it exactly.
    const full = numbered(lines);
    if (used + full.length <= maxChars) {
      blocks.push(`=== ${path} ===\n${full}`);
      used += full.length;
      included.push(path);
    } else {
      const outline = outlineOf(lines);
      if (outline && used + outline.length <= maxChars) {
        blocks.push(`=== ${path} (outline only — full text not shown) ===\n${outline}`);
        used += outline.length;
      }
    }
  }

  const ed = activeEd;
  let selection: Selection | undefined;
  if (ed && activeUri && !ed.selection.isEmpty) {
    selection = {
      path: rel(activeUri),
      startLine: ed.selection.start.line + 1,
      endLine: ed.selection.end.line + 1,
      text: ed.document.getText(ed.selection).slice(0, 6000),
    };
  }

  const parts = [
    scope ? `CURRENT PROJECT FOLDER: ${scope}/ (only files in this folder are shown; create new files inside it)` : '',
    `PROJECT FILES (${all.length}):\n${listing.join('\n') || '(none yet)'}`,
    `FILE CONTENTS (line numbers are for reference only and are NOT part of the file):\n${blocks.join('\n\n') || '(none)'}`,
  ];
  if (activeUri) parts.push(`ACTIVE FILE: ${rel(activeUri)}`);
  if (selection) {
    parts.push(`STUDENT SELECTION (${selection.path}, lines ${selection.startLine}-${selection.endLine}):\n${selection.text}`);
  }
  return {
    text: parts.filter(Boolean).join('\n\n'),
    files: included,
    fileCount: all.length,
    paths: all.map(rel),
    folder: folder.uri,
    active: activeUri ? rel(activeUri) : undefined,
    activeContent: activeUri && ed ? ed.document.getText() : undefined,
    selection,
  };
}

/** Cheap summary for the header chip (no file reads). */
export function quickInfo(): { active: string; selection: string } {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.uri.scheme !== 'file') return { active: '', selection: '' };
  const active = vscode.workspace.asRelativePath(ed.document.uri, false).replace(/\\/g, '/');
  const sel = ed.selection;
  const selection = sel.isEmpty ? '' : `lines ${sel.start.line + 1}–${sel.end.line + 1}`;
  return { active, selection };
}

/** Project file paths (workspace-relative), for the header count and the "code goes in" picker. */
export async function listFiles(scope?: string): Promise<string[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return [];
  const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, INCLUDE), EXCLUDE, 400);
  return found
    .map(u => vscode.workspace.asRelativePath(u, false).replace(/\\/g, '/'))
    .filter(p => !SKIP_NAMES.test(p) && inScope(p, scope))
    .sort();
}

function inScope(path: string, scope?: string): boolean {
  return !scope || path.startsWith(scope + '/');
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
