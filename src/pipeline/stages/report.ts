import type {
  Stage,
  StageInput,
  StageOutput,
  StageContext,
  Finding,
  ReviewReport,
  Severity,
} from "../types";

export class ReportStage implements Stage {
  name = "report";
  requiresAi = false;

  async run(input: StageInput, ctx: StageContext): Promise<StageOutput> {
    const findings = input.previous?.data.findings as Finding[] ?? input.accumulated;

    const report = buildReport(input.review.id, ctx.config.project.name, input.review, findings);

    return {
      stage: this.name,
      data: { report },
      findings,
    };
  }
}

function buildReport(
  reviewId: string,
  project: string,
  review: { base_ref: string; head_ref: string; ref_id?: string },
  findings: Finding[]
): ReviewReport {
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    warning: 0,
    suggestion: 0,
    info: 0,
  };
  const byCategory: Record<string, number> = {};

  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  }

  return {
    review_id: reviewId,
    project,
    ref: review.ref_id ?? `${review.base_ref}..${review.head_ref}`,
    timestamp: new Date().toISOString(),
    summary: {
      total: findings.length,
      by_severity: bySeverity,
      by_category: byCategory,
    },
    findings,
  };
}

/** Markdown形式のレポート生成 */
export function formatMarkdown(report: ReviewReport): string {
  const lines: string[] = [];

  lines.push(`# Revi Review Report`);
  lines.push(`**Project:** ${report.project}`);
  lines.push(`**Ref:** ${report.ref}`);
  lines.push(`**Date:** ${report.timestamp}`);
  lines.push("");

  // サマリ
  lines.push(`## Summary`);
  lines.push(`Total findings: **${report.summary.total}**`);
  lines.push("");
  lines.push("| Severity | Count |");
  lines.push("|----------|-------|");
  for (const [sev, count] of Object.entries(report.summary.by_severity)) {
    if (count > 0) {
      const icon =
        sev === "critical" ? "🔴" : sev === "warning" ? "🟡" : sev === "suggestion" ? "🔵" : "⚪";
      lines.push(`| ${icon} ${sev} | ${count} |`);
    }
  }
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No issues found. ✅");
    return lines.join("\n");
  }

  // Findings
  lines.push(`## Findings`);
  lines.push("");

  for (const f of report.findings) {
    const loc = f.line_start
      ? `${f.file}:${f.line_start}${f.line_end ? `-${f.line_end}` : ""}`
      : f.file;
    const icon =
      f.severity === "critical"
        ? "🔴"
        : f.severity === "warning"
          ? "🟡"
          : f.severity === "suggestion"
            ? "🔵"
            : "⚪";

    lines.push(`### ${icon} ${f.title}`);
    lines.push(`**${f.severity}** | ${f.category} | \`${loc}\` | confidence: ${f.confidence}`);
    lines.push("");
    lines.push(f.description);

    if (f.suggestion) {
      lines.push("");
      lines.push(`**Suggestion:** ${f.suggestion.description}`);
      if (f.suggestion.diff) {
        lines.push("```diff");
        lines.push(f.suggestion.diff);
        lines.push("```");
      }
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
