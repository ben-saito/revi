import { resolve, join } from "path";
import { Store } from "../../store/db";
import { buildReport, formatMarkdown } from "../../pipeline/stages/report";
import { SEVERITY_ORDER } from "../../utils";
import { printTerminal } from "./review";
import type { Severity } from "../../pipeline/types";
import chalk from "chalk";

interface ShowOptions {
  projectDir: string;
  format: string;
  severity?: string;
}

export function showCommand(reviewId: string, opts: ShowOptions) {
  const root = resolve(opts.projectDir);
  const dbPath = join(root, ".revi", "db.sqlite");

  let store: Store;
  try {
    store = new Store(dbPath);
  } catch {
    console.error(chalk.red("✗ No review history found. Run `revi init` and `revi review` first."));
    process.exit(1);
  }

  try {
    let review;
    try {
      review = store.getReview(reviewId);
    } catch (err) {
      console.error(chalk.red(`✗ ${(err as Error).message}`));
      process.exit(1);
    }
    if (!review) {
      console.error(chalk.red(`✗ Review not found: ${reviewId}`));
      process.exit(1);
    }

    let minSeverity: Severity | undefined;
    if (opts.severity) {
      if (!SEVERITY_ORDER.includes(opts.severity as Severity)) {
        console.error(chalk.red(`✗ Invalid severity: ${opts.severity}. Must be one of: ${SEVERITY_ORDER.join(", ")}`));
        process.exit(1);
      }
      minSeverity = opts.severity as Severity;
    }

    const findings = store.getFindings(review.id, minSeverity);
    const tokensUsed = store.getTokensUsed(review.id);

    switch (opts.format) {
      case "json": {
        const report = buildReport(review, review.project, findings);
        console.log(JSON.stringify(report, null, 2));
        break;
      }
      case "markdown": {
        const report = buildReport(review, review.project, findings);
        console.log(formatMarkdown(report));
        break;
      }
      default: {
        const ref = review.head_ref ? `${review.base_ref}..${review.head_ref}` : `${review.base_ref}..(working tree)`;
        console.log(chalk.blue("▸ Revi Review"));
        console.log(chalk.gray(`  Project:  ${review.project}`));
        console.log(chalk.gray(`  Review:   ${review.id}`));
        console.log(chalk.gray(`  Diff:     ${ref}`));
        console.log(chalk.gray(`  Date:     ${review.created_at}`));
        console.log("");
        printTerminal(findings, tokensUsed);
        break;
      }
    }
  } finally {
    store.close();
  }
}
