import type { MessageType } from "@prisma/client";
import { db } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { getLLMClient, runAgent, type LLMClient } from "@/services/ai";
import { FALLBACK_REPLY } from "@/services/ai/prompt";
import { audit } from "@/services/audit";
import {
  addInternalNote,
  applyDeliveryStatus,
  findOrCreateConversation,
  recordInboundMessage,
  requestHuman,
  sendTextToCustomer,
} from "@/services/conversations";
import { findOrCreateCustomerByPhone } from "@/services/customers";
import { getCredentials, getWhatsAppService, type InboundMessage, type StatusUpdate } from "@/services/whatsapp";
import type { SystemActor } from "@/types/actor";

export interface ProcessSummary {
  messages: number;
  duplicates: number;
  unrouted: number;
  statuses: number;
  errors: string[];
}

const HANDOFF_PATTERNS: RegExp[] = [
  /\b(speak|talk|chat|connect|transfer)\b[^.?!\n]{0,25}\b(to|with)\b[^.?!\n]{0,20}\b(someone|somebody|a human|human|a person|person|agent|representative|staff|manager|consultant|mechanic|salesperson|sales|owner|real)\b/i,
  /\b(real person|live agent|human agent|customer service|call me|phone me|ring me)\b/i,
  /\bhuman\b/i,
];

export function wantsHuman(text: string): boolean {
  return HANDOFF_PATTERNS.some((p) => p.test(text));
}

const HANDOFF_REPLY = "No problem - I've flagged this for a member of the team and they'll pick up the conversation with you here shortly.";
const MEDIA_REPLY = "Thanks for that! I can only read text messages at the moment - could you type out what you need (or the part/vehicle details) and I'll take it from there?";

const locks = new Map<string, Promise<unknown>>();

/** Serialise processing per conversation so rapid-fire messages do not race each other. Single-instance only; swap for a Redis/advisory lock when scaling out. */
async function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(conversationId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(conversationId, next);
  try {
    return await next;
  } finally {
    if (locks.get(conversationId) === next) locks.delete(conversationId);
  }
}

function toMessageType(t: InboundMessage["type"]): MessageType {
  switch (t) {
    case "text":
    case "button":
    case "interactive":
      return "TEXT";
    case "image":
    case "sticker":
    case "video":
      return "IMAGE";
    case "audio":
      return "AUDIO";
    case "document":
      return "DOCUMENT";
    case "location":
      return "LOCATION";
    default:
      return "OTHER";
  }
}

export async function processWebhookPayload(payload: unknown, opts: { llm?: LLMClient } = {}): Promise<ProcessSummary> {
  const summary: ProcessSummary = { messages: 0, duplicates: 0, unrouted: 0, statuses: 0, errors: [] };
  const parsed = getWhatsAppService().receiveMessage(payload);

  for (const status of parsed.statuses) {
    try {
      await processStatus(status);
      summary.statuses++;
    } catch (e) {
      summary.errors.push(`status ${status.messageId}: ${errorMessage(e)}`);
    }
  }
  for (const msg of parsed.messages) {
    try {
      const r = await processInboundMessage(msg, opts);
      if (r === "duplicate") summary.duplicates++;
      else if (r === "unrouted") summary.unrouted++;
      else summary.messages++;
    } catch (e) {
      console.error("[whatsapp] failed to process inbound message", e);
      summary.errors.push(`message ${msg.messageId}: ${errorMessage(e)}`);
    }
  }
  return summary;
}

async function processStatus(s: StatusUpdate) {
  const map = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" } as const;
  await applyDeliveryStatus(s.messageId, map[s.status], s.error);
}

export async function processInboundMessage(
  msg: InboundMessage,
  opts: { llm?: LLMClient } = {},
): Promise<"processed" | "duplicate" | "unrouted"> {
  const business = msg.phoneNumberId
    ? await db.business.findUnique({ where: { whatsappPhoneNumberId: msg.phoneNumberId } })
    : null;
  if (!business) {
    console.warn(`[whatsapp] no business is connected to phone number id "${msg.phoneNumberId}"`);
    return "unrouted";
  }
  const actor: SystemActor = { kind: "system", businessId: business.id, label: "whatsapp" };

  const customer = await findOrCreateCustomerByPhone(actor, msg.from);
  const conversation = await findOrCreateConversation(actor, customer.id, msg.from);

  const text = (msg.text ?? msg.caption ?? "").trim();
  const isTextual = ["text", "button", "interactive", "location"].includes(msg.type);
  const content = text || `[${msg.type}]`;

  const { duplicate } = await recordInboundMessage(conversation.id, {
    content: msg.type === "text" || !text ? content : `${text}`,
    messageType: toMessageType(msg.type),
    whatsappMessageId: msg.messageId,
  });
  if (duplicate) return "duplicate";

  if (msg.profileName && !customer.name) {
    const prior = await db.message.count({ where: { conversationId: conversation.id, messageType: "NOTE" } });
    if (prior === 0) await addInternalNote(conversation.id, `WhatsApp profile name: ${msg.profileName}`);
  }

  try {
    await getWhatsAppService().markAsRead(getCredentials(business), msg.messageId);
  } catch {
    // Read receipts are best-effort.
  }

  await withConversationLock(conversation.id, async () => {
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    if (conv.handler === "HUMAN" || conv.status === "HUMAN_REQUIRED") return;

    // Answer the latest customer message; an earlier queued run may already have covered this one.
    const latestInbound = await db.message.findFirst({
      where: { conversationId: conv.id, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, content: true },
    });
    if (!latestInbound) return;
    const answered = await db.message.findFirst({
      where: { conversationId: conv.id, direction: "OUTBOUND", sender: { in: ["AI", "BUSINESS"] }, createdAt: { gt: latestInbound.createdAt } },
      select: { id: true },
    });
    if (answered) return;

    if (text && wantsHuman(text)) {
      await requestHuman(actor, conv.id, `Customer said: "${text.slice(0, 200)}"`);
      await sendTextToCustomer(conv.id, { text: HANDOFF_REPLY, sender: "AI" });
      return;
    }

    if (!isTextual && !text) {
      await sendTextToCustomer(conv.id, { text: MEDIA_REPLY, sender: "AI" });
      return;
    }

    let reply: string | null = null;
    try {
      const llm = opts.llm ?? getLLMClient();
      const result = await runAgent({ llm, ctx: { businessId: business.id, conversationId: conv.id } });
      reply = result.reply;
      if (!reply) throw new Error("The assistant did not produce a reply");
    } catch (e) {
      const detail = errorMessage(e);
      console.error("[ai] agent failed", e);
      await audit(actor, { action: "ai.error", entityType: "Conversation", entityId: conv.id, summary: `AI failed: ${detail}` });
      // The business sees the real error; the customer only gets a friendly message.
      await requestHuman(actor, conv.id, "AI assistant unavailable", { note: `AI assistant error (customer received a generic reply): ${detail}` });
      await sendTextToCustomer(conv.id, { text: FALLBACK_REPLY, sender: "AI" });
      return;
    }

    // If more messages arrived while thinking, drop this reply: the queued run answers with full context.
    const newest = await db.message.findFirst({ where: { conversationId: conv.id, direction: "INBOUND" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (newest && newest.id !== latestInbound.id) return;

    const outcome = await sendTextToCustomer(conv.id, { text: reply, sender: "AI" });
    if (!outcome.sent) {
      await addInternalNote(conv.id, `Reply could not be delivered on WhatsApp: ${outcome.error}. Use "Retry" on the message.`);
    }
  });
  return "processed";
}
