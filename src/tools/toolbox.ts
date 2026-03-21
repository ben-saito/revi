import { execSync } from "child_process";
import { resolve, relative } from "path";
import { readdirSync, statSync } from "fs";

export class ToolBox {
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = resolve(repoRoot);
  }

  /** git diff between two refs */
  gitDiff(base: string, head: string, paths?: string[]): string {
    const pathArgs = paths?.length ? ["--", ...paths] : [];
    return this.git(["diff", base, head, ...pathArgs]);
  }

  /** git show a file at a specific ref */
  gitShow(ref: string, path: string): string {
    return this.git(["show", `${ref}:${path}`]);
  }

  /** git blame */
  gitBlame(path: string, lineStart?: number, lineEnd?: number): string {
    const args = ["blame", path];
    if (lineStart && lineEnd) {
      args.push(`-L${lineStart},${lineEnd}`);
    }
    return this.git(args);
  }

  /** git log */
  gitLog(ref?: string, maxCount = 20): string {
    const args = ["log", "--oneline", `-n${maxCount}`];
    if (ref) args.push(ref);
    return this.git(args);
  }

  /** git grep */
  gitGrep(pattern: string, paths?: string[]): string {
    const args = ["grep", "-n", pattern];
    if (paths?.length) args.push("--", ...paths);
    try {
      return this.git(args);
    } catch {
      return ""; // no matches
    }
  }

  /** Read file with optional line range */
  readFile(path: string, lineStart?: number, lineEnd?: number): string {
    const fullPath = this.safePath(path);
    const file = Bun.file(fullPath);
    // Synchronous read via node compat
    const content = require("fs").readFileSync(fullPath, "utf-8") as string;
    if (!lineStart) return content;

    const lines = content.split("\n");
    const start = Math.max(0, lineStart - 1);
    const end = lineEnd ?? lines.length;
    return lines.slice(start, end).join("\n");
  }

  /** List files in directory */
  listFiles(path: string): string[] {
    const fullPath = this.safePath(path);
    return readdirSync(fullPath).filter((f) => {
      try {
        return statSync(resolve(fullPath, f)).isFile();
      } catch {
        return false;
      }
    });
  }

  /** Get surrounding context for a file at given lines */
  getContext(path: string, lineStart: number, lineEnd: number, padding = 50): string {
    const fullPath = this.safePath(path);
    const content = require("fs").readFileSync(fullPath, "utf-8") as string;
    const lines = content.split("\n");
    const start = Math.max(0, lineStart - padding - 1);
    const end = Math.min(lines.length, lineEnd + padding);
    return lines.slice(start, end).join("\n");
  }

  /** Detect language from file extension */
  detectLanguage(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const langMap: Record<string, string> = {
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
    return langMap[ext] ?? "unknown";
  }

  private git(args: string[]): string {
    return execSync(`git ${args.join(" ")}`, {
      cwd: this.repoRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  }

  private safePath(path: string): string {
    const full = resolve(this.repoRoot, path);
    const rel = relative(this.repoRoot, full);
    if (rel.startsWith("..") || rel.startsWith("/")) {
      throw new Error(`Path traversal blocked: ${path}`);
    }
    return full;
  }
}
