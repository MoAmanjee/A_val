import { db } from "@/lib/db";
import type { ChatMessage, LLMClient, ToolCall } from "@/services/ai/llm";
import { buildSystemPrompt } from "@/services/ai/prompt";
import { executeTool, toolDefinitions, type ToolContext, type ToolResult } from "@/services/ai/tools";

export interface AgentRunResult {
  reply: string | null;
  steps: number;
  toolCalls: { name: string; args: string; result: ToolResult }[];
}

const MAX_STEPS = 8;
const HISTORY_LIMIT = 40;

async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  const rows = await db.message.findMany({
    where: { conversationId, messageType: { not: "NOTE" } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  rows.reverse();
  const out: ChatMessage[] = [];
  for (const m of rows) {
    if (m.direction === "INBOUND") {
      const label = m.messageType === "TEXT" ? "" : `[${m.messageType.toLowerCase()} message] `;
      out.push({ role: "user", content: `${label}${m.content}` });
    } else if (m.messageType === "DOCUMENT") {
      out.push({ role: "assistant", content: "[The team sent the customer an official quotation PDF]" });
    } else if (m.sender === "BUSINESS") {
      out.push({ role: "assistant", content: `[Message from a team member] ${m.content}` });
    } else {
      out.push({ role: "assistant", content: m.content });
    }
  }
  return out;
}

/**
 * Run one agent turn: the model may call tools (executed through the permission-checked
 * tool layer) until it produces a customer-facing reply. Returns the reply text; sending
 * it is the caller's job.
 */
export async function runAgent(params: { llm: LLMClient; ctx: ToolContext }): Promise<AgentRunResult> {
  const { llm, ctx } = params;
  const conv = await db.conversation.findFirstOrThrow({
    where: { id: ctx.conversationId, businessId: ctx.businessId },
    include: { business: true, customer: true, vehicle: true },
  });
  const openQuote = await db.quotation.findFirst({
    where: { conversationId: conv.id, businessId: ctx.businessId, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"] } },
    orderBy: { createdAt: "desc" },
    select: { quoteNumber: true, status: true },
  });
  const system = buildSystemPrompt({ business: conv.business, customer: conv.customer, vehicle: conv.vehicle, openQuote });

  const messages = await loadHistory(conv.id);
  const executed: AgentRunResult["toolCalls"] = [];

  for (let step = 1; step <= MAX_STEPS; step++) {
    const res = await llm.complete({ system, messages, tools: toolDefinitions });
    if (!res.toolCalls.length) {
      const reply = res.content?.trim() || null;
      return { reply, steps: step, toolCalls: executed };
    }
    messages.push({ role: "assistant", content: res.content, toolCalls: res.toolCalls });
    for (const call of res.toolCalls as ToolCall[]) {
      const result = await executeTool(ctx, call.name, call.arguments);
      executed.push({ name: call.name, args: call.arguments, result });
      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
    }
  }
  return { reply: null, steps: MAX_STEPS, toolCalls: executed };
}
