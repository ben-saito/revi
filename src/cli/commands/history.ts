import { resolve, join } from "path";
import { Store } from "../../store/db";
import chalk from "chalk";

interface HistoryOptions {
  projectDir: string;
  limit: string;
  format: string;
}

export function historyCommand(opts: HistoryOptions) {
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
    const limit = parseInt(opts.limit, 10) || 10;
    const reviews = store.listReviews(limit);

    if (reviews.length === 0) {
      console.log(chalk.gray("No reviews found."));
      return;
    }

    if (opts.format === "json") {
      console.log(JSON.stringify(reviews, null, 2));
      return;
    }

    if (opts.format === "markdown") {
      const lines: string[] = [];
      lines.push("# Review History");
      lines.push("");
      lines.push("| ID | Status | Project | Ref | Date | Findings |");
      lines.push("|-----|--------|---------|-----|------|----------|");
      for (const r of reviews) {
        const shortId = r.id.slice(0, 8);
        const ref = r.head_ref ? `${r.base_ref}..${r.head_ref}` : `${r.base_ref}..(working tree)`;
        const counts: string[] = [];
        if (r.critical_count > 0) counts.push(`🔴 ${r.critical_count}`);
        if (r.warning_count > 0) counts.push(`🟡 ${r.warning_count}`);
        const other = r.finding_count - r.critical_count - r.warning_count;
        if (other > 0) counts.push(`🔵 ${other}`);
        const findingSummary = counts.length > 0 ? counts.join(" ") : "✅ clean";
        const statusIcon = r.status === "completed" ? "✅" : r.status === "failed" ? "❌" : "⏳";
        lines.push(`| \`${shortId}\` | ${statusIcon} ${r.status} | ${r.project} | \`${ref}\` | ${r.created_at} | ${findingSummary} |`);
      }
      console.log(lines.join("\n"));
      return;
    }

    console.log(chalk.blue("▸ Review History\n"));

    for (const r of reviews) {
      const shortId = r.id.slice(0, 8);
      const ref = r.head_ref ? `${r.base_ref}..${r.head_ref}` : `${r.base_ref}..(working tree)`;
      const statusColor = r.status === "completed" ? chalk.green : r.status === "failed" ? chalk.red : chalk.yellow;

      const counts: string[] = [];
      if (r.critical_count > 0) counts.push(chalk.red(`${r.critical_count} critical`));
      if (r.warning_count > 0) counts.push(chalk.yellow(`${r.warning_count} warning`));
      const other = r.finding_count - r.critical_count - r.warning_count;
      if (other > 0) counts.push(chalk.gray(`${other} other`));
      const findingSummary = counts.length > 0 ? counts.join(", ") : chalk.green("clean");

      console.log(`${chalk.bold(shortId)}  ${statusColor(r.status.padEnd(9))}  ${r.project}`);
      console.log(chalk.gray(`  ${ref}  |  ${r.created_at}  |  ${findingSummary}`));
      console.log("");
    }
  } finally {
    store.close();
  }
}
