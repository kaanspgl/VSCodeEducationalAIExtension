import fs from "node:fs/promises";
import path from "node:path";
import { normalizePath } from "@core/vibe/edits";

const EXTS = /\.(py|js|jsx|ts|tsx|java|c|cpp|h|hpp|cs|go|rs|rb|php|html|css|scss|sql|sh|json|md|txt)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "out", "dist", "build", "__pycache__", ".venv", "venv", ".vscode", "coverage", ".idea"]);
const SKIP_NAMES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.min\.(js|css)$/;
const MAX_FILE_BYTES = 60_000;

/** One participant's project folder on the server. Every path is project-relative POSIX and can't escape the folder. */
export class Workspace {
  constructor(readonly root: string) {}

  /** Absolute path for a project-relative one, or undefined if it would leave the folder. */
  abs(rel: string): string | undefined {
    const n = normalizePath(rel);
    if (!n) return undefined;
    const full = path.resolve(this.root, ...n.split("/"));
    return full.startsWith(path.resolve(this.root) + path.sep) ? full : undefined;
  }

  /** File text, or undefined if it doesn't exist (or, with `maxBytes`, is bigger than that). */
  async read(rel: string, maxBytes = Infinity): Promise<string | undefined> {
    const f = this.abs(rel);
    if (!f) return undefined;
    try {
      const st = await fs.stat(f);
      if (!st.isFile() || st.size > maxBytes) return undefined;
      return await fs.readFile(f, "utf8");
    } catch {
      return undefined;
    }
  }

  /** For the model's context: big files are listed but not read. */
  readForContext(rel: string): Promise<string | undefined> {
    return this.read(rel, MAX_FILE_BYTES);
  }

  async ensure(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }

  async write(rel: string, content: string): Promise<void> {
    const f = this.abs(rel);
    if (!f) throw new Error(`Not a valid file path: ${rel}`);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, content, "utf8");
  }

  async mkdir(rel: string): Promise<void> {
    const f = this.abs(rel);
    if (!f) throw new Error(`Not a valid folder name: ${rel}`);
    await fs.mkdir(f, { recursive: true });
  }

  async isFolder(rel: string): Promise<boolean> {
    const f = this.abs(rel);
    if (!f) return false;
    try {
      return (await fs.stat(f)).isDirectory();
    } catch {
      return false;
    }
  }

  /** Project files (code and text only), sorted; `scope` limits them to one project folder. */
  async list(scope?: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, rel: string) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name), r);
        } else if (EXTS.test(e.name) && !SKIP_NAMES.test(r) && (!scope || r.startsWith(scope + "/"))) {
          out.push(r);
        }
        if (out.length >= 400) return;
      }
    };
    await walk(this.root, "");
    return out.sort();
  }
}
