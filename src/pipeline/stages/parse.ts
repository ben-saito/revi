import { randomUUID } from "crypto";
import type {
  Stage,
  StageInput,
  StageOutput,
  StageContext,
  FileChange,
  Hunk,
  ParsedDiff,
} from "../types";

export class ParseStage implements Stage {
  name = "parse";
  requiresAi = false;

  async run(input: StageInput, ctx: StageContext): Promise<StageOutput> {
    const { review } = input;
    const rawDiff = ctx.tools.gitDiff(review.base_ref, review.head_ref);
    const parsed = parseDiff(rawDiff, ctx);

    // 各ファイルの周辺コンテキストを収集
    for (const file of parsed.files) {
      if (file.change_type === "deleted") continue;
      try {
        const firstHunk = file.hunks[0];
        const lastHunk = file.hunks[file.hunks.length - 1];
        if (firstHunk && lastHunk) {
          file.context = {
            surrounding_code: ctx.tools.getContext(
              file.path,
              firstHunk.new_start,
              lastHunk.new_start + lastHunk.new_lines
            ),
          };
        }
      } catch {
        // ファイルが存在しない場合等は無視
      }
    }

    return {
      stage: this.name,
      data: { parsed },
      findings: [],
    };
  }
}

function parseDiff(raw: string, ctx: StageContext): ParsedDiff {
  const files: FileChange[] = [];
  const fileBlocks = raw.split(/^diff --git /m).filter(Boolean);

  let totalInsertions = 0;
  let totalDeletions = 0;
  const languages = new Set<string>();

  for (const block of fileBlocks) {
    const headerMatch = block.match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const oldPath = headerMatch[1];
    const newPath = headerMatch[2];
    const path = newPath;

    // change type
    let change_type: FileChange["change_type"] = "modified";
    if (block.includes("new file mode")) change_type = "added";
    else if (block.includes("deleted file mode")) change_type = "deleted";
    else if (oldPath !== newPath) change_type = "renamed";

    // language
    const language = ctx.tools.detectLanguage(path);
    if (language !== "unknown") languages.add(language);

    // hunks
    const hunks: Hunk[] = [];
    const hunkRegex = /^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@(.*)/gm;
    let match;
    const hunkPositions: { start: number; header: RegExpMatchArray }[] = [];

    while ((match = hunkRegex.exec(block)) !== null) {
      hunkPositions.push({ start: match.index, header: match });
    }

    for (let i = 0; i < hunkPositions.length; i++) {
      const { header } = hunkPositions[i];
      const contentStart = hunkPositions[i].start + header[0].length;
      const contentEnd =
        i + 1 < hunkPositions.length ? hunkPositions[i + 1].start : block.length;
      const content = block.slice(contentStart, contentEnd).trim();

      const insertions = (content.match(/^\+/gm) || []).length;
      const deletions = (content.match(/^-/gm) || []).length;
      totalInsertions += insertions;
      totalDeletions += deletions;

      hunks.push({
        old_start: parseInt(header[1]),
        old_lines: parseInt(header[2] || "1"),
        new_start: parseInt(header[3]),
        new_lines: parseInt(header[4] || "1"),
        content,
      });
    }

    // Extract the full diff for this file (after the header)
    const diffStart = block.indexOf("@@");
    const diff = diffStart >= 0 ? block.slice(diffStart) : "";

    files.push({
      path,
      language,
      change_type,
      diff,
      hunks,
    });
  }

  return {
    files,
    summary: {
      files_changed: files.length,
      insertions: totalInsertions,
      deletions: totalDeletions,
      languages: [...languages],
    },
  };
}
