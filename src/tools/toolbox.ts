import { spawnSync } from "child_process";
import { resolve, relative, extname, basename, sep } from "path";
import { readFileSync, readdirSync, realpathSync } from "fs";

const SAFE_REF_PATTERN = /^[a-zA-Z0-9._~\-\/^@{}:]+$/;

function validateRef(ref: string): void {
  if (ref && !SAFE_REF_PATTERN.test(ref)) {
    throw new Error(`Invalid git ref: ${ref}`);
  }
}

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  rb: "ruby",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  swift: "swift",
  kt: "kotlin",
  php: "php",
  sh: "shell",
  bash: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  json: "json",
  md: "markdown",
  sql: "sql",
};

export class ToolBox {
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = resolve(repoRoot);
  }

  gitDiff(base: string, head: string, paths?: string[]): string {
    validateRef(base);
    validateRef(head);
    const pathArgs = paths?.length ? ["--", ...paths] : [];
    const args = head ? ["diff", base, head, ...pathArgs] : ["diff", base, ...pathArgs];
    return this.git(args);
  }

  gitShow(ref: string, path: string): string {
    validateRef(ref);
    return this.git(["show", `${ref}:${path}`]);
  }

  gitBlame(path: string, lineStart?: number, lineEnd?: number): string {
    const args = ["blame", "--", path];
    if (lineStart && lineEnd) {
      args.push(`-L${lineStart},${lineEnd}`);
    }
    return this.git(args);
  }

  gitLog(ref?: string, maxCount = 20): string {
    if (ref) validateRef(ref);
    const args = ["log", "--oneline", `-n${maxCount}`];
    if (ref) args.push(ref);
    return this.git(args);
  }

  gitGrep(pattern: string, paths?: string[]): string {
    const args = ["grep", "-n", "-F", "--", pattern];
    if (paths?.length) args.push(...paths);
    try {
      return this.git(args);
    } catch {
      return "";
    }
  }

  readFile(path: string, lineStart?: number, lineEnd?: number): string {
    const fullPath = this.safePath(path);
    const content = readFileSync(fullPath, "utf-8");
    if (!lineStart) return content;

    const lines = content.split("\n");
    const start = Math.max(0, lineStart - 1);
    const end = lineEnd ?? lines.length;
    return lines.slice(start, end).join("\n");
  }

  listFiles(path: string): string[] {
    const fullPath = this.safePath(path);
    return readdirSync(fullPath, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  }

  getContext(path: string, lineStart: number, lineEnd: number, padding = 50): string {
    const fullPath = this.safePath(path);
    const content = readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, lineStart - padding - 1);
    const end = Math.min(lines.length, lineEnd + padding);
    return lines.slice(start, end).join("\n");
  }

  detectLanguage(path: string): string {
    const ext = extname(path).slice(1).toLowerCase();
    return LANG_MAP[ext] ?? "unknown";
  }

  private git(args: string[]): string {
    const result = spawnSync("git", args, {
      cwd: this.repoRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `git exited with ${result.status}`);
    return result.stdout.trim();
  }

  private safePath(path: string): string {
    const full = resolve(this.repoRoot, path);
    const rel = relative(this.repoRoot, full);
    if (rel.startsWith("..") || rel.startsWith("/")) {
      throw new Error(`Path traversal blocked: ${path}`);
    }
    // シンボリックリンク経由のパストラバーサルを防止
    const realRoot = realpathSync(this.repoRoot);
    const realFull = realpathSync(full);
    if (!realFull.startsWith(realRoot + sep) && realFull !== realRoot) {
      throw new Error(`Path traversal via symlink blocked: ${path}`);
    }
    return full;
  }
}
