import { randomUUID } from "crypto";
import type {
  Stage,
  StageContext,
  StageInput,
  StageOutput,
  ReviewMeta,
  Finding,
} from "./types";
import { RateLimiter } from "../ai/rate-limiter";

// Built-in stages
import { ParseStage } from "./stages/parse";
import { UnderstandStage } from "./stages/understand";
import { ReviewStage } from "./stages/review";
import { IntegrateStage } from "./stages/integrate";
import { CrossReviewStage } from "./stages/cross-review";
import { ConsistencyStage } from "./stages/consistency";
import { ReportStage } from "./stages/report";

const BUILTIN_STAGES: Record<string, () => Stage> = {
  parse: () => new ParseStage(),
  understand: () => new UnderstandStage(),
  review: () => new ReviewStage(),
  "cross-review": () => new CrossReviewStage(),
  consistency: () => new ConsistencyStage(),
  integrate: () => new IntegrateStage(),
  report: () => new ReportStage(),
};

export class PipelineEngine {
  private ctx: StageContext;
  private rateLimiter: RateLimiter;

  constructor(ctx: StageContext) {
    this.ctx = ctx;
    this.rateLimiter = new RateLimiter(ctx.config.rate_limit);
  }

  async run(review: ReviewMeta, stageNames?: string[]): Promise<PipelineResult> {
    const names = stageNames ?? this.ctx.config.pipeline.stages;
    const stages = names.map((name) => {
      const factory = BUILTIN_STAGES[name];
      if (!factory) throw new Error(`Unknown stage: ${name}`);
      return factory();
    });

    const runId = randomUUID();
    this.ctx.store.createReview(review);
    this.ctx.store.createPipelineRun(runId, review.id, names);
    this.ctx.store.updateReviewStatus(review.id, "running");

    let previous: StageOutput | null = null;
    let accumulated: Finding[] = [];
    let totalTokens = 0;

    try {
      for (const stage of stages) {
        // レート制御
        if (stage.requiresAi) {
          await this.rateLimiter.acquire();
        }

        const input: StageInput = { review, previous, accumulated };
        const output = await this.runStageWithRetry(stage, input);

        // integrate/report ステージは accumulated を置き換える（フィルタ・統合済み）
        if (stage.name === "integrate" || stage.name === "report") {
          accumulated = output.findings;
        } else {
          accumulated.push(...output.findings);
        }
        totalTokens += output.tokens_used ?? 0;
        previous = output;

        // ステージ間クールダウン
        if (stage.requiresAi) {
          this.rateLimiter.reportSuccess(estimateCost(output.tokens_used ?? 0));
          await this.rateLimiter.stageCooldown();
        }
      }

      // findings を DB に保存（不正なエントリをフィルタ）
      const validFindings = accumulated.filter(
        (f) => f.title && f.file && f.severity && f.category && f.description
      );
      if (validFindings.length > 0) {
        this.ctx.store.insertFindings(review.id, validFindings);
      }
      accumulated = validFindings;
      this.ctx.store.completePipelineRun(runId, totalTokens);
      this.ctx.store.updateReviewStatus(review.id, "completed");

      return {
        review_id: review.id,
        run_id: runId,
        findings: accumulated,
        tokens_used: totalTokens,
        status: "completed",
      };
    } catch (err) {
      this.ctx.store.updateReviewStatus(review.id, "failed");
      throw err;
    }
  }

  private async runStageWithRetry(
    stage: Stage,
    input: StageInput,
    maxRetries = 3
  ): Promise<StageOutput> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await stage.run(input, this.ctx);
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if (status === 429 || status === 529) {
          this.rateLimiter.reportError(status);
          if (attempt < maxRetries) {
            const retryAfter = (err as { headers?: Record<string, string> }).headers?.[
              "retry-after"
            ];
            await this.rateLimiter.backoff(
              attempt,
              retryAfter ? Number(retryAfter) * 1000 : undefined
            );
            continue;
          }
        }
        throw err;
      }
    }
    throw new Error("Unreachable");
  }
}

export interface PipelineResult {
  review_id: string;
  run_id: string;
  findings: Finding[];
  tokens_used: number;
  status: "completed" | "failed";
}

function estimateCost(tokens: number): number {
  // 概算: $3/MTok input + $15/MTok output → 平均 $5/MTok
  return (tokens / 1_000_000) * 5;
}
