import type { AiProvider } from "../ai/provider";
import type { ToolBox } from "../tools/toolbox";
import type { PromptRegistry } from "../prompts/registry";
import type { Store } from "../store/db";

// --- Finding (レビュー結果の最小単位) ---

export type Severity = "critical" | "warning" | "suggestion" | "info";
export type Category =
  | "bug"
  | "security"
  | "performance"
  | "style"
  | "correctness"
  | "maintainability";

export interface Finding {
  id: string;
  file: string;
  line_start?: number;
  line_end?: number;
  severity: Severity;
  category: Category;
  title: string;
  description: string;
  suggestion?: {
    description: string;
    diff?: string;
  };
  confidence: number;
  stage: string;
  aspect?: string;
}

// --- Diff / Context ---

export interface FileChange {
  path: string;
  language: string;
  change_type: "added" | "modified" | "deleted" | "renamed";
  diff: string;
  hunks: Hunk[];
  context?: {
    surrounding_code: string;
    callers?: string[];
    callees?: string[];
  };
}

export interface Hunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  content: string;
}

export interface ParsedDiff {
  files: FileChange[];
  summary: {
    files_changed: number;
    insertions: number;
    deletions: number;
    languages: string[];
  };
}

// --- Stage interface ---

export interface StageInput {
  review: ReviewMeta;
  previous: StageOutput | null;
  accumulated: Finding[];
}

export interface StageOutput {
  stage: string;
  data: Record<string, unknown>;
  findings: Finding[];
  tokens_used?: number;
}

export interface StageContext {
  ai: AiProvider;
  tools: ToolBox;
  prompts: PromptRegistry;
  config: ProjectConfig;
  store: Store;
}

export interface Stage {
  name: string;
  requiresAi: boolean;
  run(input: StageInput, ctx: StageContext): Promise<StageOutput>;
}

// --- Review ---

export interface ReviewMeta {
  id: string;
  project: string;
  source: "local_diff" | "github_pr" | "gitlab_mr";
  base_ref: string;
  head_ref: string;
  ref_id?: string;
}

// --- Config ---

export interface ProjectConfig {
  project: {
    name: string;
    description?: string;
    languages?: string[];
  };
  provider: {
    default: string;
    [key: string]: unknown;
  };
  pipeline: {
    stages: string[];
    timeout?: number;
  };
  review: {
    aspects: string[];
    severity_threshold: Severity;
    max_findings_per_file: number;
    rules?: {
      ignore_patterns?: string[];
      coding_standards?: string;
    };
  };
  rate_limit: {
    max_reviews_per_hour: number;
    max_budget_per_hour_usd: number;
    max_budget_per_day_usd: number;
    cooldown_between_stages_ms: number;
    max_concurrent_reviews: number;
  };
}

// --- Review Report ---

export interface ReviewReport {
  review_id: string;
  project: string;
  ref: string;
  timestamp: string;
  summary: {
    total: number;
    by_severity: Record<Severity, number>;
    by_category: Record<string, number>;
  };
  findings: Finding[];
}
