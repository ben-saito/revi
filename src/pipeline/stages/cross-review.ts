import type {
  Stage,
  StageInput,
  StageOutput,
  StageContext,
  Finding,
  ParsedDiff,
} from "../types";
import { safeJsonParse, parseFinding, totalTokens, withOutputLanguage } from "../../utils";

export class CrossReviewStage implements Stage {
  name = "cross-review";
  requiresAi = true;

  async run(input: StageInput, ctx: StageContext): Promise<StageOutput> {
    const parsed = input.previous?.data.parsed as ParsedDiff | undefined
      ?? (input.previous?.data as Record<string, unknown>).parsed as ParsedDiff | undefined;

    if (!parsed) throw new Error("Parsed diff required for cross-review");

    const existingFindings = input.accumulated;

    // Skip cross-review for trivial diffs or when first pass found nothing in small changes
    const totalChanges = parsed.summary.insertions + parsed.summary.deletions;
    if (totalChanges < 5 || (existingFindings.length === 0 && totalChanges < 50)) {
      return {
        stage: this.name,
        data: {},
        findings: [],
        tokens_used: 0,
      };
    }

    const prompt = ctx.prompts.render("cross-review", {
      project_name: ctx.config.project.name,
      languages: parsed.summary.languages.join(", "),
      files: parsed.files.map((f) => ({
        path: f.path,
        language: f.language,
        diff: f.diff,
        context: f.context,
      })),
      existing_findings_json: JSON.stringify(
        existingFindings.map((f) => ({
          file: f.file,
          line_start: f.line_start,
          severity: f.severity,
          category: f.category,
          title: f.title,
        })),
        null,
        2
      ),
    });

    const result = await ctx.ai.generate({
      system: withOutputLanguage(
        `You are an expert code reviewer performing a second-pass review. Your job is to find issues that a first-pass review missed. Focus on subtle bugs, cross-file interactions, implicit assumptions, race conditions, and edge cases. Do NOT repeat findings that were already reported. Respond with a JSON array of new concerns only.`,
        ctx.config
      ),
      messages: [{ role: "user", content: prompt }],
      response_format: "json",
      temperature: 0.4,
    });

    const raw = safeJsonParse<unknown>(result.content, []);
    const arr = Array.isArray(raw)
      ? raw
      : (raw as Record<string, unknown>).concerns ?? (raw as Record<string, unknown>).findings ?? [];
    const findings = (arr as Record<string, unknown>[]).map((c) =>
      parseFinding(c, { stage: this.name, aspect: "cross-review" })
    );

    return {
      stage: this.name,
      data: { parsed },
      findings,
      tokens_used: totalTokens(result),
    };
  }
}
