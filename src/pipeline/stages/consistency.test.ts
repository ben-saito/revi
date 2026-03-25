import { test, expect, mock } from "bun:test";
import { ConsistencyStage } from "./consistency";
import type { StageContext, StageInput, ParsedDiff, Finding, ProjectConfig } from "../types";

const makeConfig = (): ProjectConfig => ({
  project: { name: "test-project" },
  provider: { default: "claude-code" },
  pipeline: { stages: ["parse", "understand", "review", "cross-review", "consistency", "integrate", "report"] },
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

const makeParsedDiff = (overrides?: Partial<ParsedDiff>): ParsedDiff => ({
  files: [
    {
      path: "src/pipeline/stages/foo.ts",
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

test("ConsistencyStage skips trivial diffs", async () => {
  const stage = new ConsistencyStage();
  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: {
      stage: "cross-review",
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

test("ConsistencyStage skips when only deleted files", async () => {
  const stage = new ConsistencyStage();
  const parsed = makeParsedDiff();
  parsed.files[0].change_type = "deleted";

  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: { stage: "cross-review", data: { parsed }, findings: [] },
    accumulated: [],
  };

  const ctx = { config: makeConfig() } as unknown as StageContext;
  const output = await stage.run(input, ctx);
  expect(output.findings).toEqual([]);
  expect(output.tokens_used).toBe(0);
});

test("ConsistencyStage gathers siblings and calls AI", async () => {
  const stage = new ConsistencyStage();
  const parsed = makeParsedDiff();

  const mockGenerate = mock(() =>
    Promise.resolve({
      content: JSON.stringify([
        {
          file: "src/pipeline/stages/foo.ts",
          line_start: 3,
          severity: "suggestion",
          category: "style",
          title: "Naming inconsistency",
          description: "Other files use camelCase but this uses snake_case",
          confidence: 0.7,
        },
      ]),
      tokens_used: { input: 800, output: 200 },
    })
  );

  const mockRender = mock((name: string, vars: Record<string, unknown>) => {
    expect(name).toBe("consistency");
    return "rendered prompt";
  });

  const mockListFiles = mock(() => ["foo.ts", "bar.ts", "review.ts"]);
  const mockReadFile = mock(() => "export class BarStage { }");
  const mockDetectLanguage = mock(() => "typescript");

  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: { stage: "cross-review", data: { parsed }, findings: [] },
    accumulated: [],
  };

  const ctx = {
    ai: { generate: mockGenerate },
    prompts: { render: mockRender },
    config: makeConfig(),
    tools: {
      listFiles: mockListFiles,
      readFile: mockReadFile,
      detectLanguage: mockDetectLanguage,
    },
  } as unknown as StageContext;

  const output = await stage.run(input, ctx);

  expect(mockGenerate).toHaveBeenCalledTimes(1);
  expect(mockListFiles).toHaveBeenCalledWith("src/pipeline/stages");
  expect(output.findings).toHaveLength(1);
  expect(output.findings[0].stage).toBe("consistency");
  expect(output.findings[0].aspect).toBe("consistency");
  expect(output.findings[0].title).toBe("Naming inconsistency");
  expect(output.tokens_used).toBe(1000);
});

test("ConsistencyStage handles missing siblings gracefully", async () => {
  const stage = new ConsistencyStage();
  const parsed = makeParsedDiff();

  const mockGenerate = mock(() =>
    Promise.resolve({
      content: "[]",
      tokens_used: { input: 300, output: 10 },
    })
  );

  const mockListFiles = mock(() => { throw new Error("ENOENT"); });

  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: { stage: "cross-review", data: { parsed }, findings: [] },
    accumulated: [],
  };

  const ctx = {
    ai: { generate: mockGenerate },
    prompts: { render: mock(() => "prompt") },
    config: makeConfig(),
    tools: {
      listFiles: mockListFiles,
      readFile: mock(() => ""),
      detectLanguage: mock(() => "typescript"),
    },
  } as unknown as StageContext;

  const output = await stage.run(input, ctx);
  expect(output.findings).toHaveLength(0);
});

test("ConsistencyStage excludes the changed file from siblings", async () => {
  const stage = new ConsistencyStage();
  const parsed = makeParsedDiff();
  // File is src/pipeline/stages/foo.ts

  const readPaths: string[] = [];
  const mockReadFile = mock((path: string) => {
    readPaths.push(path);
    return "content";
  });

  const mockGenerate = mock(() =>
    Promise.resolve({
      content: "[]",
      tokens_used: { input: 300, output: 10 },
    })
  );

  // listFiles returns the changed file itself + others
  const mockListFiles = mock(() => ["foo.ts", "bar.ts"]);
  const mockDetectLanguage = mock(() => "typescript");

  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: { stage: "cross-review", data: { parsed }, findings: [] },
    accumulated: [],
  };

  const ctx = {
    ai: { generate: mockGenerate },
    prompts: { render: mock(() => "prompt") },
    config: makeConfig(),
    tools: {
      listFiles: mockListFiles,
      readFile: mockReadFile,
      detectLanguage: mockDetectLanguage,
    },
  } as unknown as StageContext;

  await stage.run(input, ctx);

  // Should only read bar.ts, not foo.ts (the changed file)
  expect(readPaths).toEqual(["src/pipeline/stages/bar.ts"]);
});

test("ConsistencyStage limits siblings to MAX_SIBLINGS (3)", async () => {
  const stage = new ConsistencyStage();
  const parsed = makeParsedDiff();

  const readPaths: string[] = [];
  const mockReadFile = mock((path: string) => {
    readPaths.push(path);
    return "content";
  });

  const mockGenerate = mock(() =>
    Promise.resolve({
      content: "[]",
      tokens_used: { input: 300, output: 10 },
    })
  );

  // 5 sibling files but limit is 3
  const mockListFiles = mock(() => ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]);
  const mockDetectLanguage = mock(() => "typescript");

  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: { stage: "cross-review", data: { parsed }, findings: [] },
    accumulated: [],
  };

  const ctx = {
    ai: { generate: mockGenerate },
    prompts: { render: mock(() => "prompt") },
    config: makeConfig(),
    tools: {
      listFiles: mockListFiles,
      readFile: mockReadFile,
      detectLanguage: mockDetectLanguage,
    },
  } as unknown as StageContext;

  await stage.run(input, ctx);
  expect(readPaths).toHaveLength(3);
});

test("ConsistencyStage throws when parsed diff is missing", async () => {
  const stage = new ConsistencyStage();
  const input: StageInput = {
    review: { id: "r1", project: "test", source: "local_diff", base_ref: "HEAD~1", head_ref: "HEAD" },
    previous: { stage: "cross-review", data: {}, findings: [] },
    accumulated: [],
  };

  const ctx = { config: makeConfig() } as unknown as StageContext;
  expect(stage.run(input, ctx)).rejects.toThrow("Parsed diff required");
});
