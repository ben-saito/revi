import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import Handlebars from "handlebars";

const BUILTIN_PROMPTS: Record<string, string> = {
  understand: `You are analyzing code changes to understand their intent and impact.

## Commit/PR Description
{{commit_message}}

## Changed Files
{{#each files}}
### {{this.path}} ({{this.language}})
\`\`\`diff
{{this.diff}}
\`\`\`
{{/each}}

Analyze these changes and respond with JSON:
{
  "intent": "one-line description of what this change does",
  "change_type": "feature|bugfix|refactor|config|docs|test",
  "risk_areas": ["area1", "area2"],
  "focus_points": ["what to look for in review"]
}`,

  "review/correctness": `You are a senior code reviewer focusing on correctness.

## Project: {{project_name}}
## Language: {{language}}

{{#if coding_standards}}
## Coding Standards
{{coding_standards}}
{{/if}}

## Changes to Review
{{#each files}}
### {{this.path}}
\`\`\`diff
{{this.diff}}
\`\`\`

{{#if this.context.surrounding_code}}
#### Context
\`\`\`{{this.language}}
{{this.context.surrounding_code}}
\`\`\`
{{/if}}
{{/each}}

Find bugs, logic errors, edge cases, and error handling issues.
Respond with JSON array of concerns:
[{
  "file": "path",
  "line_start": N,
  "line_end": N,
  "severity": "critical|warning|suggestion|info",
  "category": "correctness",
  "title": "short title",
  "description": "detailed explanation",
  "suggestion": { "description": "fix", "diff": "- old\\n+ new" },
  "confidence": 0.0-1.0
}]

Only report genuine issues. If no issues found, return [].`,

  "review/security": `You are a security auditor reviewing code changes.

## Changes
{{#each files}}
### {{this.path}} ({{this.language}})
\`\`\`diff
{{this.diff}}
\`\`\`
{{/each}}

Check for: injection vulnerabilities, auth/authz issues, sensitive data exposure, insecure crypto, SSRF, path traversal, and other OWASP Top 10 risks.

Respond with JSON array of concerns (same schema as correctness review).
Only report genuine security issues. Return [] if none found.`,

  "review/performance": `You are a performance engineer reviewing code changes.

## Changes
{{#each files}}
### {{this.path}} ({{this.language}})
\`\`\`diff
{{this.diff}}
\`\`\`
{{/each}}

Check for: O(n²) or worse algorithms, unnecessary allocations, missing caching, N+1 queries, blocking I/O in async context, memory leaks.

Respond with JSON array of concerns. Only flag clear performance issues, not micro-optimizations. Return [] if none found.`,

  "review/maintainability": `You are reviewing code for maintainability.

## Changes
{{#each files}}
### {{this.path}} ({{this.language}})
\`\`\`diff
{{this.diff}}
\`\`\`
{{/each}}

Check for: confusing naming, excessive complexity, DRY violations, missing error context, unclear control flow.

Respond with JSON array of concerns. Focus on significant issues only. Return [] if none found.`,

  integrate: `You are consolidating code review findings.

## All Concerns from Previous Stages
{{concerns_json}}

Tasks:
1. Deduplicate: merge concerns pointing to same code location
2. Filter false positives: remove issues that are clearly not bugs
3. Score severity: re-assess severity based on full context
4. Group: cluster related findings

Respond with JSON:
{
  "findings": [same schema as concerns, with updated severity/confidence],
  "suppressed": [{ "original_title": "...", "reason": "why filtered" }]
}`,
};

export class PromptRegistry {
  private projectDir?: string;
  private userDir: string;
  private cache = new Map<string, HandlebarsTemplateDelegate>();

  constructor(projectDir?: string) {
    this.projectDir = projectDir;
    this.userDir = join(
      process.env.HOME ?? process.env.USERPROFILE ?? ".",
      ".config",
      "revi",
      "prompts"
    );
  }

  render(name: string, vars: Record<string, unknown>): string {
    const tmpl = this.getTemplate(name);
    return tmpl(vars);
  }

  private getTemplate(name: string): HandlebarsTemplateDelegate {
    if (this.cache.has(name)) return this.cache.get(name)!;

    const source = this.loadSource(name);
    const tmpl = Handlebars.compile(source);
    this.cache.set(name, tmpl);
    return tmpl;
  }

  private loadSource(name: string): string {
    // 1. プロジェクト固有
    if (this.projectDir) {
      const path = resolve(this.projectDir, ".revi", "prompts", `${name}.md`);
      if (existsSync(path)) return readFileSync(path, "utf-8");
    }

    // 2. ユーザー共有
    const userPath = join(this.userDir, `${name}.md`);
    if (existsSync(userPath)) return readFileSync(userPath, "utf-8");

    // 3. ビルトイン
    if (BUILTIN_PROMPTS[name]) return BUILTIN_PROMPTS[name];

    throw new Error(`Prompt template not found: ${name}`);
  }
}
