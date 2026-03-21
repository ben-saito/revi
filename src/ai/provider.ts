export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GenerateParams {
  system: string;
  messages: Message[];
  tools?: ToolDefinition[];
  response_format?: "text" | "json";
  temperature?: number;
  max_tokens?: number;
}

export interface GenerateResult {
  content: string;
  tokens_used: {
    input: number;
    output: number;
  };
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiProvider {
  name: string;
  generate(params: GenerateParams): Promise<GenerateResult>;
}

export async function createProvider(
  name: string,
  config: Record<string, unknown>
): Promise<AiProvider> {
  switch (name) {
    case "claude-code": {
      const { ClaudeCodeProvider } = await import("./claude-code");
      return new ClaudeCodeProvider(config);
    }
    case "claude": {
      const { ClaudeProvider } = await import("./claude");
      return new ClaudeProvider(config);
    }
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
