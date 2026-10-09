import { env } from "@/lib/env";
import { LLMUnavailableError, type LLMClient } from "@/services/ai/llm";
import { OpenAILLMClient } from "@/services/ai/openai";

export * from "@/services/ai/llm";
export { runAgent, type AgentRunResult } from "@/services/ai/agent";
export { executeTool, toolDefinitions, type ToolContext, type ToolResult } from "@/services/ai/tools";
export { buildSystemPrompt } from "@/services/ai/prompt";

let override: LLMClient | null = null;

/** Tests and local scripts inject a scripted client here. */
export function setLLMClient(client: LLMClient | null) {
  override = client;
}

export function getLLMClient(): LLMClient {
  if (override) return override;
  if (!env.openaiApiKey) throw new LLMUnavailableError("OPENAI_API_KEY is not configured");
  return new OpenAILLMClient();
}

export function isLLMConfigured(): boolean {
  return Boolean(override) || Boolean(env.openaiApiKey);
}
