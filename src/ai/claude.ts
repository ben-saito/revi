import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, GenerateParams, GenerateResult } from "./provider";

const ALLOWED_API_KEY_ENVS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY_REVI",
  "CLAUDE_API_KEY",
]);

export class ClaudeProvider implements AiProvider {
  name = "claude";
  private client: Anthropic;
  private model: string;

  constructor(config: Record<string, unknown> = {}) {
    const apiKeyEnv = (config.api_key_env as string) ?? "ANTHROPIC_API_KEY";
    if (!ALLOWED_API_KEY_ENVS.has(apiKeyEnv)) {
      throw new Error(`Disallowed api_key_env: ${apiKeyEnv}. Allowed: ${[...ALLOWED_API_KEY_ENVS].join(", ")}`);
    }
    this.client = new Anthropic({ apiKey: process.env[apiKeyEnv] });
    this.model = (config.model as string) ?? "claude-sonnet-4-20250514";
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: params.max_tokens ?? 8192,
      temperature: params.temperature ?? 0.2,
      system: params.system,
      messages: params.messages.map((m) => ({
        role: m.role === "system" ? "user" : m.role,
        content: m.content,
      })),
    });

    const textBlock = response.content.find((b) => b.type === "text");

    return {
      content: textBlock?.text ?? "",
      tokens_used: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  }
}
