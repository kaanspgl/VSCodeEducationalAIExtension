import * as vscode from 'vscode';

/**
 * Edit format. The model proposes changes as SEARCH/REPLACE blocks (robust for local models):
 *
 *   <<<<<<< SEARCH path/to/file.py
 *   exact existing lines
 *   =======
 *   replacement lines
 *   >>>>>>> REPLACE
 *
 * An empty SEARCH section creates a new file (or replaces an existing one wholesale).
 */
export type EditBlock = { path: string; search: string; replace: string };

const BLOCK_RE = /<<<<<<< SEARCH[ \t]+(\S[^\n]*)\r?\n([\s\S]*?)\r?\n?=======\r?\n([\s\S]*?)\r?\n?>>>>>>> REPLACE/g;

export function parseBlocks(text: string): { blocks: EditBlock[]; rest: string } {
  const blocks: EditBlock[] = [];
  const rest = text
    .replace(BLOCK_RE, (_m, p: string, search: string, replace: string) => {
      const path = normalizePath(p);
      if (path) blocks.push({ path, search, replace });
      return '';
    })
    // drop fences the model wrapped around now-removed blocks
    .replace(/```[a-zA-Z]*\s*```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { blocks, rest };
}

const LANG_EXT: Record<string, string> = {
  python: 'py', py: 'py', javascript: 'js', js: 'js', node: 'js', typescript: 'ts', ts: 'ts', jsx: 'jsx', tsx: 'tsx',
  java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', cs: 'cs', go: 'go', rust: 'rs', ruby: 'rb',
  php: 'php', html: 'html', css: 'css', json: 'json', sql: 'sql', bash: 'sh', sh: 'sh',
};
const FILE_RE = /([\w./-]+\.(?:py|js|ts|jsx|tsx|java|c|cpp|h|cs|go|rs|rb|php|html|css|json|sql|sh))\b/;

/**
 * Fallback for models that ignore the edit format and answer with ordinary fenced code.
 * Turns each substantial fenced block into a whole-file change (still reviewed as a diff
 * before anything is written): to the file it names, else to the active file when it looks
 * like a full replacement, else to a new file.
 */
export function fencedToBlocks(
  text: string,
  existing: Set<string>,
  active?: { path: string; content: string },
  dir?: string
): { blocks: EditBlock[]; rest: string } {
  const blocks: EditBlock[] = [];
  const used = new Set<string>();
  const FENCE = /(^|\n)([^\n]*)\n?```([^\n`]*)\n([\s\S]*?)```/g;

  const rest = text.replace(FENCE, (whole, lead: string, before: string, info: string, code: string) => {
    const lines = code.replace(/\n$/, '').split('\n');
    if (lines.length < 3) return whole; // small inline example, keep in the explanation

    const infoTokens = info.trim().split(/\s+/).filter(Boolean);
    const lang = (infoTokens[0] || '').toLowerCase();
    const named =
      infoTokens.map(t => FILE_RE.exec(t)?.[1]).find(Boolean) ||
      FILE_RE.exec(before)?.[1] ||
      /^\s*(?:#|\/\/|<!--)\s*([\w./-]+\.\w+)/.exec(lines[0])?.[1];

    let target = named ? normalizePath(named) : undefined;
    if (target && dir && !target.startsWith(dir + '/')) target = `${dir}/${target.split('/').pop()}`;
    if (!target) {
      const ext = LANG_EXT[lang] || (active ? active.path.split('.').pop() : undefined);
      if (!ext) return whole;
      if (active && active.path.endsWith('.' + ext) && looksLikeWholeFile(lines, active.content)) {
        target = active.path;
      } else {
        target = freshName(`${dir ? dir + '/' : ''}main.${ext}`, existing, used);
      }
    }
    if (used.has(target)) return whole;
    used.add(target);
    blocks.push({ path: target, search: '', replace: code });
    return `${lead}${before.replace(FILE_RE, '`$1`')}\n_(proposed as a change to \`${target}\` below)_`;
  });
  return { blocks, rest: rest.trim() };
}

function looksLikeWholeFile(lines: string[], current: string): boolean {
  const cur = current.split('\n').filter(l => l.trim());
  if (!cur.length) return true;
  if (lines.length >= cur.length * 0.6) return true;
  // shares the same top-level definitions as the current file
  const defs = (s: string[]) => s.map(l => /^(?:def|class|function|async function)\s+(\w+)/.exec(l.trim())?.[1]).filter(Boolean);
  const a = new Set(defs(cur));
  const b = defs(lines);
  return b.length > 0 && b.filter(n => a.has(n)).length >= Math.max(1, Math.ceil(a.size * 0.5));
}

function freshName(base: string, existing: Set<string>, used: Set<string>): string {
  if (!existing.has(base) && !used.has(base)) return base;
  const slash = base.lastIndexOf('/') + 1;
  const prefix = base.slice(0, slash);
  const file = base.slice(slash);
  const [stem, ext] = [file.slice(0, file.lastIndexOf('.')), file.slice(file.lastIndexOf('.'))];
  for (let i = 2; ; i++) {
    const n = `${prefix}${stem === 'main' ? 'program' : stem}${i === 2 ? '' : i}${ext}`;
    if (!existing.has(n) && !used.has(n)) return n;
  }
}

export function blocksToText(blocks: EditBlock[]): string {
  return blocks.map(b => `<<<<<<< SEARCH ${b.path}\n${b.search}${b.search && !b.search.endsWith('\n') ? '\n' : ''}=======\n${b.replace}${b.replace.endsWith('\n') ? '' : '\n'}>>>>>>> REPLACE`).join('\n\n');
}

/** Workspace-relative POSIX path, or undefined if it could escape the workspace. */
export function normalizePath(p: string): string | undefined {
  const n = p.trim().replace(/^`+|`+$/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!n || n.startsWith('/') || /^[A-Za-z]:/.test(n)) return undefined;
  const parts = n.split('/');
  if (parts.includes('..') || parts[0] === '.git' || parts.includes('node_modules')) return undefined;
  return n;
}

export type ApplyResult = { content: string; applied: number; failed: number; added: number; removed: number };

/** Applies blocks (all for one file) to `original` (undefined = file does not exist yet). */
export function applyBlocks(original: string | undefined, blocks: EditBlock[]): ApplyResult {
  const eol = original && original.includes('\r\n') ? '\r\n' : '\n';
  let content = (original ?? '').replace(/\r\n/g, '\n');
  let applied = 0, failed = 0, added = 0, removed = 0;

  for (const b of blocks) {
    const search = b.search.replace(/\r\n/g, '\n');
    const replace = b.replace.replace(/\r\n/g, '\n');
    if (search.trim() === '') {
      if (original !== undefined) removed += lineCount(content);
      content = replace.endsWith('\n') ? replace : replace + '\n';
      added += lineCount(replace);
      applied++;
      continue;
    }
    const idx = content.indexOf(search);
    if (idx >= 0) {
      content = content.slice(0, idx) + replace + content.slice(idx + search.length);
    } else {
      const fuzzy = fuzzyReplace(content, search, replace);
      if (fuzzy === undefined) { failed++; continue; }
      content = fuzzy;
    }
    added += lineCount(replace);
    removed += lineCount(search);
    applied++;
  }
  return { content: content.replace(/\n/g, eol), applied, failed, added, removed };
}

function lineCount(s: string): number {
  return s === '' ? 0 : s.replace(/\n$/, '').split('\n').length;
}

/** Whitespace-tolerant match: compares trimmed lines, then re-indents the replacement. */
function fuzzyReplace(content: string, search: string, replace: string): string | undefined {
  const lines = content.split('\n');
  const sLines = search.split('\n');
  while (sLines.length && sLines[0].trim() === '') sLines.shift();
  while (sLines.length && sLines[sLines.length - 1].trim() === '') sLines.pop();
  if (!sLines.length) return undefined;

  for (let i = 0; i + sLines.length <= lines.length; i++) {
    let ok = true;
    for (let k = 0; k < sLines.length; k++) {
      if (lines[i + k].trim() !== sLines[k].trim()) { ok = false; break; }
    }
    if (!ok) continue;

    const sInd = leading(sLines[0]);
    const aInd = leading(lines[i]);
    let rLines = replace.replace(/\n$/, '').split('\n');
    if (sInd !== aInd) {
      rLines = rLines.map(r => (r.trim() === '' ? r : r.startsWith(sInd) ? aInd + r.slice(sInd.length) : r));
    }
    return [...lines.slice(0, i), ...rLines, ...lines.slice(i + sLines.length)].join('\n');
  }
  return undefined;
}

function leading(s: string): string {
  return /^[ \t]*/.exec(s)![0];
}

/** Serves proposed file contents to VS Code's diff editor. */
export class ProposedContent implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'vibelearner-proposed';
  private static store = new Map<string, string>();

  static put(id: string, name: string, content: string): vscode.Uri {
    const key = `/${id}/${name}`;
    ProposedContent.store.set(key, content);
    return vscode.Uri.from({ scheme: ProposedContent.scheme, path: key });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return ProposedContent.store.get(uri.path) ?? '';
  }
}
