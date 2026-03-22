import type {
  Stage,
  StageInput,
  StageOutput,
  StageContext,
  Finding,
  ParsedDiff,
} from "../types";
import { safeJsonParse, parseFinding, totalTokens, withOutputLanguage } from "../../utils";

export class ReviewStage implements Stage {
  name = "review";
  requiresAi = true;

  async run(input: StageInput, ctx: StageContext): Promise<StageOutput> {
    const parsed = input.previous?.data.parsed as ParsedDiff;
    if (!parsed) throw new Error("Parsed diff required");

    // Read coding standards once, not per-aspect
    let codingStandards = "";
    if (ctx.config.review.rules?.coding_standards) {
      try {
        codingStandards = ctx.tools.readFile(ctx.config.review.rules.coding_standards);
      } catch {}
    }

    const aspects = ctx.config.review.aspects;
    const results = await Promise.all(
      aspects.map((aspect) =>
        this.reviewAspect(aspect, parsed, codingStandards, ctx)
      )
    );

    const allConcerns: Finding[] = [];
    let tokens = 0;
    for (const r of results) {
      allConcerns.push(...r.findings);
      tokens += r.tokens;
    }

    return {
      stage: this.name,
      data: { parsed, concerns: allConcerns },
      findings: allConcerns,
      tokens_used: tokens,
    };
  }

  private async reviewAspect(
    aspect: string,
    parsed: ParsedDiff,
    codingStandards: string,
    ctx: StageContext
  ): Promise<{ findings: Finding[]; tokens: number }> {
    const prompt = ctx.prompts.render(`review/${aspect}`, {
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
      system: withOutputLanguage(
        `You are a code reviewer specializing in ${aspect}. Respond with a JSON array of concerns only.`,
        ctx.config
      ),
      messages: [{ role: "user", content: prompt }],
      response_format: "json",
      temperature: 0.2,
    });

    const raw = safeJsonParse<unknown>(result.content, []);
    const arr = Array.isArray(raw)
      ? raw
      : (raw as Record<string, unknown>).concerns ?? [];
    const concerns = (arr as Record<string, unknown>[]).map((c) =>
      parseFinding(c, { stage: this.name, aspect, category: aspect as Finding["category"] })
    );

    return { findings: concerns, tokens: totalTokens(result) };
  }
}
