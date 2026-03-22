import type { Stage, StageInput, StageOutput, StageContext, Finding } from "../types";
import { SEVERITY_ORDER, safeJsonParse, parseFinding, totalTokens } from "../../utils";

export class IntegrateStage implements Stage {
  name = "integrate";
  requiresAi = true;

  async run(input: StageInput, ctx: StageContext): Promise<StageOutput> {
    const concerns = input.accumulated;

    if (concerns.length === 0) {
      return {
        stage: this.name,
        data: { findings: [], suppressed: [] },
        findings: [],
        tokens_used: 0,
      };
    }

    const prompt = ctx.prompts.render("integrate", {
      concerns_json: JSON.stringify(concerns, null, 2),
    });

    const result = await ctx.ai.generate({
      system:
        "You are a senior reviewer consolidating findings. Deduplicate, filter false positives, and re-score severity. Respond with JSON only.",
      messages: [{ role: "user", content: prompt }],
      response_format: "json",
      temperature: 0.1,
    });

    const parsed = safeJsonParse<{ findings?: unknown[]; suppressed?: unknown[] }>(
      result.content,
      {}
    );

    let findings: Finding[];
    if (parsed.findings) {
      findings = (parsed.findings as Record<string, unknown>[]).map((f) =>
        parseFinding(f, { stage: this.name })
      );
    } else {
      findings = concerns;
    }

    const suppressed = parsed.suppressed ?? [];

    // severity threshold filter
    const threshold = ctx.config.review.severity_threshold;
    const maxIdx = SEVERITY_ORDER.indexOf(threshold);
    const filtered = findings.filter(
      (f) => SEVERITY_ORDER.indexOf(f.severity) <= maxIdx
    );

    // max_findings_per_file cap
    const perFile = new Map<string, Finding[]>();
    for (const f of filtered) {
      const arr = perFile.get(f.file) ?? [];
      arr.push(f);
      perFile.set(f.file, arr);
    }

    const capped: Finding[] = [];
    for (const [, arr] of perFile) {
      arr.sort(
        (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
      );
      capped.push(...arr.slice(0, ctx.config.review.max_findings_per_file));
    }

    return {
      stage: this.name,
      data: { findings: capped, suppressed },
      findings: capped,
      tokens_used: totalTokens(result),
    };
  }
}
