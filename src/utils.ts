import { randomUUID } from "crypto";
import type { Finding, Severity, ProjectConfig } from "./pipeline/types";
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

// --- Output language ---

const ALLOWED_LANGUAGES: ReadonlySet<string> = new Set([
  "Japanese", "Chinese", "Korean", "Spanish", "French", "German",
  "Portuguese", "Italian", "Russian", "Arabic", "Hindi", "Thai",
  "Vietnamese", "Indonesian", "Malay", "Dutch", "Swedish", "Polish",
  "Turkish", "Czech", "Danish", "Finnish", "Norwegian", "Greek",
  "Hebrew", "Hungarian", "Romanian", "Ukrainian", "English",
]);

export function withOutputLanguage(system: string, config: ProjectConfig): string {
  const lang = config.review.output_language;
  if (!lang) return system;
  if (!ALLOWED_LANGUAGES.has(lang)) {
    throw new Error(`Unsupported language: "${lang}". Supported: ${[...ALLOWED_LANGUAGES].join(", ")}`);
  }
  return `${system}\n\nIMPORTANT: Write all human-readable text (title, description, suggestion) in ${lang}. Keep JSON keys, JSON enum values, file paths, and code in English.`;
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
