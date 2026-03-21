import { randomUUID } from "crypto";
import type { Stage, StageInput, StageOutput, StageContext, Finding } from "../types";

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

    let findings: Finding[] = [];
    let suppressed: unknown[] = [];

    try {
      const parsed = JSON.parse(result.content);
      findings = (parsed.findings ?? []).map((f: Record<string, unknown>) => ({
        id: randomUUID(),
        file: f.file as string,
        line_start: f.line_start as number | undefined,
        line_end: f.line_end as number | undefined,
        severity: f.severity as Finding["severity"],
        category: f.category as Finding["category"],
        title: f.title as string,
        description: f.description as string,
        suggestion: f.suggestion as Finding["suggestion"],
        confidence: (f.confidence as number) ?? 0.5,
        stage: this.name,
        aspect: f.aspect as string | undefined,
      }));
      suppressed = parsed.suppressed ?? [];
    } catch {
      // 解析失敗時はフィルタなしで通す
      findings = concerns;
    }

    // severity threshold でフィルタ
    const threshold = ctx.config.review.severity_threshold;
    const order = ["critical", "warning", "suggestion", "info"];
    const maxIdx = order.indexOf(threshold);
    const filtered = findings.filter(
      (f) => order.indexOf(f.severity) <= maxIdx
    );

    // max_findings_per_file でキャップ
    const perFile = new Map<string, Finding[]>();
    for (const f of filtered) {
      const arr = perFile.get(f.file) ?? [];
      arr.push(f);
      perFile.set(f.file, arr);
    }

    const capped: Finding[] = [];
    for (const [, arr] of perFile) {
      // severity 順でソートして上位N件
      arr.sort(
        (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)
      );
      capped.push(...arr.slice(0, ctx.config.review.max_findings_per_file));
    }

    return {
      stage: this.name,
      data: { findings: capped, suppressed },
      findings: capped,
      tokens_used: result.tokens_used.input + result.tokens_used.output,
    };
  }
}
