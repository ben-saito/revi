import { test, expect, mock } from "bun:test";
import { CrossReviewStage } from "./cross-review";
import type { StageContext, StageInput, ParsedDiff, Finding, ProjectConfig } from "../types";

const makeParsedDiff = (overrides?: Partial<ParsedDiff>): ParsedDiff => ({
  files: [
    {
      path: "src/index.ts",
      language: "typescript",
      change_type: "modified",
      diff: "- const x = 1;\n+ const x = 2;",
      hunks: [{ old_start: 1, old_lines: 1, new_start: 1, new_lines: 1, content: "" }],
    },
  ],
  summary: {
    files_changed: 1,
    insertions: 10,
    deletions: 5,
    languages: ["typescript"],
  },
  ...overrides,
});

const makeExistingFinding = (overrides?: Partial<Finding>): Finding => ({
  id: "existing-1",
  file: "src/index.ts",
  line_start: 1,
  severity: "warning",
  category: "correctness",
  title: "Existing issue",
  description: "Already found",
  confidence: 0.8,
  stage: "review",
  aspect: "correctness",
  ...overrides,
});

const makeConfig = (): ProjectConfig => ({
  project: { name: "test-project" },
  provider: { default: "claude-code" },
  pipeline: { stages: ["parse", "understand", "review", "cross-review", "integrate", "report"] },
  review: {
    aspects: ["correctness", "security", "performance", "maintainability"],
    severity_threshold: "suggestion",
    max_findings_per_file: 10,
  },
  rate_limit: {
    max_reviews_per_hour: 10,
    max_budget_per_hour_usd: 3,
    max_budget_per_day_usd: 20,
    cooldown_between_stages_ms: 0,
    max_concurrent_reviews: 2,
  },
});

test("CrossReviewStage skips when diff is trivially small (< 5 changes)", async () => {
  const stage = new CrossReviewStage();
  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: {
      stage: "review",
      data: { parsed: makeParsedDiff({ summary: { files_changed: 1, insertions: 2, deletions: 1, languages: ["typescript"] } }) },
      findings: [],
    },
    accumulated: [],
  };

  const ctx = { config: makeConfig() } as unknown as StageContext;
  const output = await stage.run(input, ctx);

  expect(output.findings).toEqual([]);
  expect(output.tokens_used).toBe(0);
});

test("CrossReviewStage skips when no findings and diff < 50 changes", async () => {
  const stage = new CrossReviewStage();
  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: {
      stage: "review",
      data: { parsed: makeParsedDiff({ summary: { files_changed: 1, insertions: 30, deletions: 10, languages: ["typescript"] } }) },
      findings: [],
    },
    accumulated: [],
  };

  const ctx = { config: makeConfig() } as unknown as StageContext;
  const output = await stage.run(input, ctx);

  expect(output.findings).toEqual([]);
  expect(output.tokens_used).toBe(0);
});

test("CrossReviewStage calls AI with existing findings context", async () => {
  const stage = new CrossReviewStage();
  const parsed = makeParsedDiff();
  const existing = [makeExistingFinding()];

  const mockGenerate = mock(() =>
    Promise.resolve({
      content: JSON.stringify([
        {
          file: "src/index.ts",
          line_start: 5,
          severity: "warning",
          category: "bug",
          title: "New issue found",
          description: "Cross-file interaction bug",
          confidence: 0.7,
        },
      ]),
      tokens_used: { input: 500, output: 200 },
    })
  );

  const mockRender = mock((name: string, vars: Record<string, unknown>) => {
    expect(name).toBe("cross-review");
    expect(vars.existing_findings_json).toBeDefined();
    return "rendered prompt";
  });

  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: {
      stage: "review",
      data: { parsed },
      findings: existing,
    },
    accumulated: existing,
  };

  const ctx = {
    ai: { generate: mockGenerate },
    prompts: { render: mockRender },
    config: makeConfig(),
  } as unknown as StageContext;

  const output = await stage.run(input, ctx);

  expect(mockGenerate).toHaveBeenCalledTimes(1);
  expect(output.findings).toHaveLength(1);
  expect(output.findings[0].title).toBe("New issue found");
  expect(output.findings[0].stage).toBe("cross-review");
  expect(output.findings[0].aspect).toBe("cross-review");
  expect(output.tokens_used).toBe(700);
});

test("CrossReviewStage handles empty AI response", async () => {
  const stage = new CrossReviewStage();
  const parsed = makeParsedDiff();

  const mockGenerate = mock(() =>
    Promise.resolve({
      content: "[]",
      tokens_used: { input: 300, output: 10 },
    })
  );

  const mockRender = mock(() => "rendered prompt");

  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: { stage: "review", data: { parsed }, findings: [] },
    accumulated: [makeExistingFinding()],
  };

  const ctx = {
    ai: { generate: mockGenerate },
    prompts: { render: mockRender },
    config: makeConfig(),
  } as unknown as StageContext;

  const output = await stage.run(input, ctx);
  expect(output.findings).toHaveLength(0);
});

test("CrossReviewStage handles { findings: [...] } response format", async () => {
  const stage = new CrossReviewStage();
  const parsed = makeParsedDiff();

  const mockGenerate = mock(() =>
    Promise.resolve({
      content: JSON.stringify({
        findings: [
          { file: "src/index.ts", severity: "suggestion", category: "maintainability", title: "Wrapped", description: "test", confidence: 0.6 },
        ],
      }),
      tokens_used: { input: 300, output: 100 },
    })
  );

  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: { stage: "review", data: { parsed }, findings: [] },
    accumulated: [makeExistingFinding()],
  };

  const ctx = {
    ai: { generate: mockGenerate },
    prompts: { render: mock(() => "prompt") },
    config: makeConfig(),
  } as unknown as StageContext;

  const output = await stage.run(input, ctx);
  expect(output.findings).toHaveLength(1);
  expect(output.findings[0].title).toBe("Wrapped");
});

test("CrossReviewStage uses higher temperature (0.4) for creative exploration", async () => {
  const stage = new CrossReviewStage();
  const parsed = makeParsedDiff();

  let capturedTemp: number | undefined;
  const mockGenerate = mock((opts: { temperature?: number }) => {
    capturedTemp = opts.temperature;
    return Promise.resolve({
      content: "[]",
      tokens_used: { input: 100, output: 10 },
    });
  });

  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: { stage: "review", data: { parsed }, findings: [] },
    accumulated: [makeExistingFinding()],
  };

  const ctx = {
    ai: { generate: mockGenerate },
    prompts: { render: mock(() => "prompt") },
    config: makeConfig(),
  } as unknown as StageContext;

  await stage.run(input, ctx);
  expect(capturedTemp).toBe(0.4);
});

test("CrossReviewStage throws when parsed diff is missing", async () => {
  const stage = new CrossReviewStage();

  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: { stage: "review", data: {}, findings: [] },
    accumulated: [],
  };

  const ctx = { config: makeConfig() } as unknown as StageContext;
  expect(stage.run(input, ctx)).rejects.toThrow("Parsed diff required");
});
