import { db } from "@/lib/db";
import type { ChatMessage, LLMClient, ToolCall } from "@/services/ai/llm";
import { buildSystemPrompt } from "@/services/ai/prompt";
import { executeTool, toolDefinitions, type ToolContext, type ToolResult } from "@/services/ai/tools";
import { findActiveOrder } from "@/services/orders/lifecycle";
import { findDraft } from "@/services/orders/cart";

export interface AgentRunResult {
  /** Text to send to the customer, or null when there is nothing to say. */
  reply: string | null;
  /** A tool already replied; the caller should not send anything more. */
  stop: boolean;
  steps: number;
  toolCalls: { name: string; args: string; result: ToolResult }[];
}

const MAX_STEPS = 6;
const HISTORY_LIMIT = 30;

async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  const rows = await db.message.findMany({
    where: { conversationId, messageType: { not: "NOTE" } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  rows.reverse();
  return rows.map<ChatMessage>((m) => {
    if (m.direction === "INBOUND") {
      const label = m.messageType === "TEXT" || m.messageType === "INTERACTIVE" ? "" : `[${m.messageType.toLowerCase()} message] `;
      return { role: "user", content: `${label}${m.content}` };
    }
    if (m.sender === "STAFF") return { role: "assistant", content: `[Message from a staff member] ${m.content}` };
    if (m.sender === "SYSTEM") return { role: "assistant", content: `[Automatic order update] ${m.content}` };
    return { role: "assistant", content: m.content };
  });
}

/**
 * Run one turn. The model may call tools until it produces a reply, or until a
 * tool reports that it has already handled the turn (a handoff, or a flow
 * message that was sent with its own buttons).
 */
export async function runAgent(params: { llm: LLMClient; ctx: ToolContext }): Promise<AgentRunResult> {
  const { llm, ctx } = params;
  const conv = await db.conversation.findFirstOrThrow({
    where: { id: ctx.conversationId, storeId: ctx.storeId },
    include: { store: true, customer: true },
  });
  const draft = await findDraft(conv.id);
  const active = await findActiveOrder(conv.id);

  const system = buildSystemPrompt({
    store: conv.store,
    customer: conv.customer,
    pendingQuestion: conv.pendingQuestion,
    hasBasket: Boolean(draft?.items.length),
    openOrderNumber: active?.orderNumber ?? null,
  });

  const messages = await loadHistory(conv.id);
  const executed: AgentRunResult["toolCalls"] = [];

  for (let step = 1; step <= MAX_STEPS; step++) {
    const res = await llm.complete({ system, messages, tools: toolDefinitions });
    if (!res.toolCalls.length) {
      return { reply: res.content?.trim() || null, stop: false, steps: step, toolCalls: executed };
    }
    messages.push({ role: "assistant", content: res.content, toolCalls: res.toolCalls });

    let stop = false;
    for (const call of res.toolCalls as ToolCall[]) {
      const result = await executeTool(ctx, call.name, call.arguments);
      executed.push({ name: call.name, args: call.arguments, result });
      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result.data) });
      if (result.stop) stop = true;
    }
    if (stop) {
      return { reply: res.content?.trim() || null, stop: true, steps: step, toolCalls: executed };
    }
  }
  return { reply: null, stop: false, steps: MAX_STEPS, toolCalls: executed };
}
