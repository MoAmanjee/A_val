import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { env } from "@/lib/env";
import { LLMUnavailableError, type ChatMessage, type LLMClient, type LLMResponse, type ToolDefinition } from "@/services/ai/llm";

export class OpenAILLMClient implements LLMClient {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey = env.openaiApiKey, private readonly model = env.openaiModel) {
    if (!apiKey) throw new LLMUnavailableError("OPENAI_API_KEY is not configured");
    this.client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 2 });
  }

  async complete(params: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LLMResponse> {
    const messages: ChatCompletionMessageParam[] = [{ role: "system", content: params.system }];
    for (const m of params.messages) {
      if (m.role === "user") messages.push({ role: "user", content: m.content });
      else if (m.role === "tool") messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
      else {
        messages.push({
          role: "assistant",
          content: m.content,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((t) => ({
                  id: t.id,
                  type: "function" as const,
                  function: { name: t.name, arguments: t.arguments },
                })),
              }
            : {}),
        });
      }
    }

    const res = await this.client.chat.completions.create({
      model: this.model,
      messages,
      // Taking an order is not a creative task; keep it predictable.
      temperature: 0.2,
      ...(params.tools.length
        ? {
            tools: params.tools.map((t) => ({
              type: "function" as const,
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    });
    const choice = res.choices[0]?.message;
    if (!choice) throw new Error("The AI provider returned no message");
    return {
      content: choice.content ?? null,
      toolCalls: (choice.tool_calls ?? [])
        .filter((t) => t.type === "function")
        .map((t) => ({
          id: t.id,
          name: (t as { function: { name: string } }).function.name,
          arguments: (t as { function: { arguments: string } }).function.arguments,
        })),
    };
  }
}
