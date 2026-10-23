import { env } from "@/lib/env";
import { LLMUnavailableError, type LLMClient } from "@/services/ai/llm";
import { OpenAILLMClient } from "@/services/ai/openai";

export * from "@/services/ai/llm";
export { runAgent } from "@/services/ai/agent";

let override: LLMClient | null = null;

/** Inject a client (tests, alternative providers). Pass null to restore the default. */
export function setLLMClient(client: LLMClient | null) {
  override = client;
}

export function getLLMClient(): LLMClient {
  if (override) return override;
  if (!env.openaiApiKey) throw new LLMUnavailableError("OPENAI_API_KEY is not configured");
  return new OpenAILLMClient();
}
