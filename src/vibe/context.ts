import * as vscode from 'vscode';
import { ContextFile, formatContext, Selection } from './contextFormat';

export { numbered } from './contextFormat';
export type { Selection } from './contextFormat';

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

  const files: ContextFile[] = [];
  let readCount = 0;
  for (const u of all) {
    let text: string | undefined;
    if (priority(u) <= 2 || readCount < 80) { text = await readText(u); readCount++; }
    files.push({ path: rel(u), text });
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

  const { text, included } = formatContext(files, maxChars, { scope, active: activeUri ? rel(activeUri) : undefined, selection });
  return {
    text,
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
