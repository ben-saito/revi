import { randomUUID } from "crypto";
import type { Finding, Severity } from "./pipeline/types";
import type { GenerateResult } from "./ai/provider";

// --- Severity ---

export const SEVERITY_ORDER: Severity[] = ["critical", "warning", "suggestion", "info"];

export type ReviewStatus = "pending" | "running" | "completed" | "failed";

// --- JSON parsing ---

export function safeJsonParse<T>(content: string, fallback: T): T {
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

// --- Token counting ---

export function totalTokens(result: GenerateResult): number {
  return result.tokens_used.input + result.tokens_used.output;
}

// --- Finding parsing ---

export function parseFinding(
  raw: Record<string, unknown>,
  defaults: Partial<Finding> = {}
): Finding {
  return {
    id: randomUUID(),
    file: (raw.file as string) ?? defaults.file ?? "",
    line_start: raw.line_start as number | undefined,
    line_end: raw.line_end as number | undefined,
    severity: (raw.severity as Severity) ?? defaults.severity ?? "info",
    category: (raw.category as Finding["category"]) ?? defaults.category ?? "correctness",
    title: (raw.title as string) ?? defaults.title ?? "",
    description: (raw.description as string) ?? defaults.description ?? "",
    suggestion: raw.suggestion as Finding["suggestion"],
    confidence: (raw.confidence as number) ?? defaults.confidence ?? 0.5,
    stage: (raw.stage as string) ?? defaults.stage ?? "",
    aspect: (raw.aspect as string) ?? defaults.aspect,
  };
}
