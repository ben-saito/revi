import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join, basename } from "path";
import type { ProjectConfig, Severity } from "../pipeline/types";

const DEFAULT_CONFIG: ProjectConfig = {
  project: {
    name: "unnamed",
  },
  provider: {
    default: "claude-code",
  },
  pipeline: {
    stages: ["parse", "understand", "review", "integrate", "report"],
    timeout: 300,
  },
  review: {
    aspects: ["correctness", "security", "performance", "maintainability"],
    severity_threshold: "suggestion" as Severity,
    max_findings_per_file: 10,
  },
  rate_limit: {
    max_reviews_per_hour: 10,
    max_budget_per_hour_usd: 3.0,
    max_budget_per_day_usd: 20.0,
    cooldown_between_stages_ms: 2000,
    max_concurrent_reviews: 2,
  },
};

export function loadConfig(projectRoot: string): ProjectConfig {
  const configPath = resolve(projectRoot, ".revi", "config.toml");

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = parseSimpleToml(raw);
    return deepMerge(DEFAULT_CONFIG, parsed) as ProjectConfig;
  } catch {
    return { ...DEFAULT_CONFIG, project: { ...DEFAULT_CONFIG.project, name: guessProjectName(projectRoot) } };
  }
}

export function initProject(projectRoot: string): string {
  const reviDir = resolve(projectRoot, ".revi");
  const configPath = join(reviDir, "config.toml");
  const promptsDir = join(reviDir, "prompts");

  if (existsSync(configPath)) {
    return `Already initialized: ${configPath}`;
  }

  mkdirSync(reviDir, { recursive: true });
  mkdirSync(promptsDir, { recursive: true });

  const name = guessProjectName(projectRoot).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const template = `[project]
name = "${name}"
# description = "Project description"
# languages = ["typescript", "python"]

[provider]
default = "claude-code"

# [provider.claude-code]
# max_budget_per_review_usd = 0.50

# [provider.claude]
# model = "claude-sonnet-4-20250514"
# api_key_env = "ANTHROPIC_API_KEY"

[pipeline]
stages = ["parse", "understand", "review", "integrate", "report"]
# timeout = 300

[review]
aspects = ["correctness", "security", "performance", "maintainability"]
severity_threshold = "suggestion"
max_findings_per_file = 10

# [review.rules]
# ignore_patterns = ["*.generated.ts", "vendor/**"]
# coding_standards = ".revi/standards.md"

[rate_limit]
max_reviews_per_hour = 10
max_budget_per_hour_usd = 3.00
max_budget_per_day_usd = 20.00
cooldown_between_stages_ms = 2000
max_concurrent_reviews = 2
`;

  writeFileSync(configPath, template);
  return `Initialized: ${configPath}`;
}

function guessProjectName(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    if (pkg.name) return pkg.name;
  } catch {}
  return basename(root) || "project";
}

/** 簡易 TOML パーサ（ネストテーブル・配列・基本型対応） */
function parseSimpleToml(src: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: string[] = [];

  for (const line of src.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // [section] or [section.sub]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].split(".");
      continue;
    }

    // key = value
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawVal = kvMatch[2].trim();
      const value = parseTomlValue(rawVal);

      let target = result as Record<string, unknown>;
      for (const part of currentSection) {
        if (!target[part] || typeof target[part] !== "object") {
          target[part] = {};
        }
        target = target[part] as Record<string, unknown>;
      }
      target[key] = value;
    }
  }

  return result;
}

function parseTomlValue(raw: string): unknown {
  // String
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  // Array
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => parseTomlValue(s.trim()));
  }
  // Boolean
  if (raw === "true") return true;
  if (raw === "false") return false;
  // Number
  const num = Number(raw);
  if (!isNaN(num)) return num;
  return raw;
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (val && typeof val === "object" && !Array.isArray(val) && result[key] && typeof result[key] === "object") {
      result[key] = deepMerge(result[key] as Record<string, unknown>, val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }
  return result;
}
