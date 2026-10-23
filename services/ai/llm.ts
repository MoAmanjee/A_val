/**
 * Minimal provider-agnostic chat + tool-calling interface. The agent only depends
 * on this, so the LLM vendor can be swapped (or scripted in tests) without
 * touching the agent, the tools, or the database layer.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string, exactly as produced by the model. */
  arguments: string;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface LLMClient {
  readonly name: string;
  complete(params: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LLMResponse>;
}

export class LLMUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMUnavailableError";
  }
}
