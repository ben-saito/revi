import { randomUUID } from "crypto";
import type {
  Stage,
  StageInput,
  StageOutput,
  StageContext,
  Finding,
  ParsedDiff,
} from "../types";

export class ReviewStage implements Stage {
  name = "review";
  requiresAi = true;

  async run(input: StageInput, ctx: StageContext): Promise<StageOutput> {
    const parsed = input.previous?.data.parsed as ParsedDiff;
    const understanding = input.previous?.data.understanding as Record<string, unknown>;
    if (!parsed) throw new Error("Parsed diff required");

    const aspects = ctx.config.review.aspects;
    const allConcerns: Finding[] = [];
    let totalTokens = 0;

    // 各観点で並列にレビュー実行
    const results = await Promise.all(
      aspects.map((aspect) => this.reviewAspect(aspect, parsed, understanding, ctx))
    );

    for (const result of results) {
      allConcerns.push(...result.findings);
      totalTokens += result.tokens;
    }

    return {
      stage: this.name,
      data: { parsed, understanding, concerns: allConcerns },
      findings: allConcerns,
      tokens_used: totalTokens,
    };
  }

  private async reviewAspect(
    aspect: string,
    parsed: ParsedDiff,
    understanding: Record<string, unknown> | undefined,
    ctx: StageContext
  ): Promise<{ findings: Finding[]; tokens: number }> {
    // コーディング規約の読み込み
    let codingStandards = "";
    if (ctx.config.review.rules?.coding_standards) {
      try {
        codingStandards = ctx.tools.readFile(ctx.config.review.rules.coding_standards);
      } catch {
        // 規約ファイルなし
      }
    }

    const promptName = `review/${aspect}`;
    const prompt = ctx.prompts.render(promptName, {
      project_name: ctx.config.project.name,
      language: parsed.summary.languages.join(", "),
      coding_standards: codingStandards,
      files: parsed.files.map((f) => ({
        path: f.path,
        language: f.language,
        diff: f.diff,
        context: f.context,
      })),
    });

    const result = await ctx.ai.generate({
      system: `You are a code reviewer specializing in ${aspect}. Respond with a JSON array of concerns only.`,
      messages: [{ role: "user", content: prompt }],
      response_format: "json",
      temperature: 0.2,
    });

    let concerns: Finding[] = [];
    try {
      const raw = JSON.parse(result.content);
      const arr = Array.isArray(raw) ? raw : raw.concerns ?? [];
      concerns = arr.map((c: Record<string, unknown>) => ({
        id: randomUUID(),
        file: c.file as string,
        line_start: c.line_start as number | undefined,
        line_end: c.line_end as number | undefined,
        severity: c.severity as Finding["severity"],
        category: (c.category as Finding["category"]) ?? aspect,
        title: c.title as string,
        description: c.description as string,
        suggestion: c.suggestion as Finding["suggestion"],
        confidence: (c.confidence as number) ?? 0.5,
        stage: this.name,
        aspect,
      }));
    } catch {
      // JSON解析失敗時は空
    }

    return {
      findings: concerns,
      tokens: result.tokens_used.input + result.tokens_used.output,
    };
  }
}
