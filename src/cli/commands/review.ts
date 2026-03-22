import { resolve, join } from "path";
import { randomUUID } from "crypto";
import { loadConfig } from "../../config/loader";
import { createProvider } from "../../ai/provider";
import { ToolBox } from "../../tools/toolbox";
import { PromptRegistry } from "../../prompts/registry";
import { Store } from "../../store/db";
import { PipelineEngine } from "../../pipeline/engine";
import { formatMarkdown } from "../../pipeline/stages/report";
import type { ReviewMeta, Severity, ReviewReport } from "../../pipeline/types";
import chalk from "chalk";

interface ReviewOptions {
  base: string;
  head: string;
  workingTree?: boolean;
  pr?: string;
  commit?: string;
  format: string;
  severity: string;
  provider?: string;
  stages?: string;
  projectDir: string;
}

export async function reviewCommand(opts: ReviewOptions) {
  const root = resolve(opts.projectDir);
  const config = loadConfig(root);

  // Provider override
  const providerName = opts.provider ?? config.provider.default;
  const providerConfig = (config.provider[providerName] as Record<string, unknown>) ?? {};
  const ai = await createProvider(providerName, providerConfig);

  // Base/head resolution
  let base = opts.base;
  let head = opts.head;

  if (opts.workingTree) {
    base = opts.base === "HEAD~1" ? "HEAD" : opts.base; // default to HEAD for working tree
    head = ""; // empty = diff against working tree
  } else if (opts.commit) {
    base = `${opts.commit}~1`;
    head = opts.commit;
  }

  const tools = new ToolBox(root);
  const prompts = new PromptRegistry(root);
  const dbPath = join(root, ".revi", "db.sqlite");
  const store = new Store(dbPath);

  const review: ReviewMeta = {
    id: randomUUID(),
    project: config.project.name,
    source: opts.pr ? "github_pr" : "local_diff",
    base_ref: base,
    head_ref: head,
    ref_id: opts.pr ?? undefined,
  };

  // Severity override
  if (opts.severity) {
    config.review.severity_threshold = opts.severity as Severity;
  }

  // Stage override
  const stageNames = opts.stages?.split(",").map((s) => s.trim());

  console.log(chalk.blue("▸ Revi Review"));
  console.log(chalk.gray(`  Project:  ${config.project.name}`));
  console.log(chalk.gray(`  Provider: ${providerName}`));
  console.log(chalk.gray(`  Diff:     ${base}..${head || "(working tree)"}`));
  console.log(chalk.gray(`  Stages:   ${(stageNames ?? config.pipeline.stages).join(" → ")}`));
  console.log("");

  const engine = new PipelineEngine({
    ai,
    tools,
    prompts,
    config,
    store,
  });

  try {
    const result = await engine.run(review, stageNames);
    const report = result.findings.length > 0
      ? buildQuickReport(review, config.project.name, result.findings)
      : null;

    // 出力
    switch (opts.format) {
      case "json":
        console.log(JSON.stringify(report ?? { findings: [] }, null, 2));
        break;
      case "markdown":
        if (report) {
          console.log(formatMarkdown(report));
        } else {
          console.log("No issues found. ✅");
        }
        break;
      default:
        printTerminal(result.findings, result.tokens_used);
        break;
    }
  } catch (err) {
    console.error(chalk.red(`✗ Review failed: ${(err as Error).message}`));
    process.exit(1);
  } finally {
    store.close();
  }
}

function printTerminal(findings: Array<{ severity: string; title: string; file: string; line_start?: number; description: string; confidence: number }>, tokensUsed: number) {
  if (findings.length === 0) {
    console.log(chalk.green("✓ No issues found"));
    console.log(chalk.gray(`  Tokens used: ${tokensUsed.toLocaleString()}`));
    return;
  }

  const icons: Record<string, string> = {
    critical: chalk.red("●"),
    warning: chalk.yellow("●"),
    suggestion: chalk.blue("●"),
    info: chalk.gray("●"),
  };

  console.log(chalk.bold(`Found ${findings.length} issue(s):\n`));

  for (const f of findings) {
    const icon = icons[f.severity] ?? "○";
    const loc = f.line_start ? `${f.file}:${f.line_start}` : f.file;
    console.log(`${icon} ${chalk.bold(f.title)}`);
    console.log(chalk.gray(`  ${loc} | ${f.severity} | confidence: ${f.confidence}`));
    console.log(`  ${f.description}`);
    console.log("");
  }

  console.log(chalk.gray(`Tokens used: ${tokensUsed.toLocaleString()}`));
}

function buildQuickReport(review: ReviewMeta, project: string, findings: Array<{ severity: string; category: string; [k: string]: unknown }>): ReviewReport {
  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  }
  return {
    review_id: review.id,
    project,
    ref: review.ref_id ?? `${review.base_ref}..${review.head_ref}`,
    timestamp: new Date().toISOString(),
    summary: {
      total: findings.length,
      by_severity: bySeverity as Record<Severity, number>,
      by_category: byCategory,
    },
    findings: findings as ReviewReport["findings"],
  };
}
