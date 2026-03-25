import type {
  Stage,
  StageInput,
  StageOutput,
  StageContext,
  ParsedDiff,
  FileChange,
} from "../types";
import { safeJsonParse, parseFinding, totalTokens, withOutputLanguage } from "../../utils";
import { dirname } from "path";

/** Max number of sibling files to include as pattern reference per changed file */
const MAX_SIBLINGS = 3;
/** Max characters to read from each sibling file */
const MAX_SIBLING_CHARS = 2000;

interface SiblingContext {
  path: string;
  content: string;
}

export class ConsistencyStage implements Stage {
  name = "consistency";
  requiresAi = true;

  async run(input: StageInput, ctx: StageContext): Promise<StageOutput> {
    const parsed = input.previous?.data.parsed as ParsedDiff | undefined
      ?? (input.previous?.data as Record<string, unknown>).parsed as ParsedDiff | undefined;

    if (!parsed) throw new Error("Parsed diff required for consistency check");

    // Skip for trivial diffs
    const totalChanges = parsed.summary.insertions + parsed.summary.deletions;
    if (totalChanges < 5) {
      return { stage: this.name, data: {}, findings: [], tokens_used: 0 };
    }

    // Only check added/modified files — deleted files have no patterns to enforce
    const targetFiles = parsed.files.filter(
      (f) => f.change_type === "added" || f.change_type === "modified"
    );
    if (targetFiles.length === 0) {
      return { stage: this.name, data: {}, findings: [], tokens_used: 0 };
    }

    // Gather sibling files as pattern reference
    const filesWithSiblings = targetFiles.map((f) => ({
      file: f,
      siblings: this.gatherSiblings(f, ctx),
    }));

    const prompt = ctx.prompts.render("consistency", {
      project_name: ctx.config.project.name,
      languages: parsed.summary.languages.join(", "),
      files: filesWithSiblings.map(({ file, siblings }) => ({
        path: file.path,
        language: file.language,
        diff: file.diff,
        context: file.context,
        siblings: siblings.map((s) => ({
          path: s.path,
          content: s.content,
        })),
        has_siblings: siblings.length > 0,
      })),
    });

    const result = await ctx.ai.generate({
      system: withOutputLanguage(
        `You are a code reviewer specializing in codebase consistency. Your job is to ensure new or modified code follows the same patterns, conventions, and style as the existing codebase. Compare the changes against sibling files (existing files in the same directory) and flag any deviations. Respond with a JSON array of concerns only.`,
        ctx.config
      ),
      messages: [{ role: "user", content: prompt }],
      response_format: "json",
      temperature: 0.2,
    });

    const raw = safeJsonParse<unknown>(result.content, []);
    const arr = Array.isArray(raw)
      ? raw
      : (raw as Record<string, unknown>).concerns ?? (raw as Record<string, unknown>).findings ?? [];
    const findings = (arr as Record<string, unknown>[]).map((c) =>
      parseFinding(c, { stage: this.name, aspect: "consistency" })
    );

    return {
      stage: this.name,
      data: { parsed },
      findings,
      tokens_used: totalTokens(result),
    };
  }

  private gatherSiblings(file: FileChange, ctx: StageContext): SiblingContext[] {
    const dir = dirname(file.path);
    const lang = file.language;
    const siblings: SiblingContext[] = [];

    try {
      const entries = ctx.tools.listFiles(dir);
      for (const entry of entries) {
        if (siblings.length >= MAX_SIBLINGS) break;

        const entryPath = dir === "." ? entry : `${dir}/${entry}`;
        // Skip the changed file itself
        if (entryPath === file.path) continue;
        // Only include files of the same language
        if (ctx.tools.detectLanguage(entryPath) !== lang) continue;

        try {
          const content = ctx.tools.readFile(entryPath);
          siblings.push({
            path: entryPath,
            content: content.slice(0, MAX_SIBLING_CHARS),
          });
        } catch {
          // File unreadable — skip
        }
      }
    } catch {
      // Directory listing failed — skip sibling collection
    }

    return siblings;
  }
}
