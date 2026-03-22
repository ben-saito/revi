import type { Stage, StageInput, StageOutput, StageContext, ParsedDiff } from "../types";
import { safeJsonParse, totalTokens } from "../../utils";

export class UnderstandStage implements Stage {
  name = "understand";
  requiresAi = true;

  async run(input: StageInput, ctx: StageContext): Promise<StageOutput> {
    const parsed = input.previous?.data.parsed as ParsedDiff;
    if (!parsed) throw new Error("Parse stage output required");

    let commitMessage = "";
    try {
      commitMessage = ctx.tools.gitLog(input.review.head_ref, 1);
    } catch {
      commitMessage = "(no commit message available)";
    }

    const prompt = ctx.prompts.render("understand", {
      commit_message: commitMessage,
      files: parsed.files.map((f) => ({
        path: f.path,
        language: f.language,
        diff: f.diff,
      })),
    });

    const result = await ctx.ai.generate({
      system: "You are a code analysis expert. Analyze changes and respond with structured JSON.",
      messages: [{ role: "user", content: prompt }],
      response_format: "json",
      temperature: 0.1,
    });

    const understanding = safeJsonParse(result.content, {
      intent: "Unable to parse",
      change_type: "unknown",
      risk_areas: [],
      focus_points: [],
    });

    return {
      stage: this.name,
      data: { parsed, understanding },
      findings: [],
      tokens_used: totalTokens(result),
    };
  }
}
