import type { AiProvider, GenerateParams, GenerateResult } from "./provider";

export class ClaudeCodeProvider implements AiProvider {
  name = "claude-code";
  private maxBudget: number;
  private allowedTools: string[];
  private cooldownMs: number;
  private lastCallAt = 0;

  constructor(config: Record<string, unknown> = {}) {
    this.maxBudget = (config.max_budget_per_review_usd as number) ?? 0.5;
    this.allowedTools = (config.allowed_tools as string[]) ?? ["Read"];
    this.cooldownMs = (config.cooldown_between_calls_ms as number) ?? 5000;
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    // クールダウン制御
    const elapsed = Date.now() - this.lastCallAt;
    if (elapsed < this.cooldownMs) {
      await Bun.sleep(this.cooldownMs - elapsed);
    }

    const prompt = this.buildPrompt(params);
    const args = [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "json",
      "--max-budget-usd",
      String(this.maxBudget),
    ];

    if (this.allowedTools.length > 0) {
      args.push("--allowedTools", this.allowedTools.join(","));
    }

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    this.lastCallAt = Date.now();

    if (exitCode !== 0) {
      throw new Error(`claude-code exited with ${exitCode}: ${stderr}`);
    }

    let result: { result?: string; usage?: { input_tokens: number; output_tokens: number } };
    try {
      result = JSON.parse(stdout);
    } catch {
      result = { result: stdout.trim() };
    }

    return {
      content: result.result ?? "",
      tokens_used: {
        input: result.usage?.input_tokens ?? 0,
        output: result.usage?.output_tokens ?? 0,
      },
    };
  }

  private buildPrompt(params: GenerateParams): string {
    const parts: string[] = [];
    if (params.system) {
      parts.push(`<system>\n${params.system}\n</system>`);
    }
    for (const msg of params.messages) {
      parts.push(`<${msg.role}>\n${msg.content}\n</${msg.role}>`);
    }
    if (params.response_format === "json") {
      parts.push("\nRespond with valid JSON only. No markdown fences.");
    }
    return parts.join("\n\n");
  }
}
