import type { ConversationStatus, DeliveryStatus, Message, MessageSender, MessageType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { errorMessage, InvalidStateError, NotFoundError } from "@/lib/errors";
import { audit } from "@/services/audit";
import { getCredentials, getWhatsAppService } from "@/services/whatsapp";
import type { Actor } from "@/types/actor";

const OPEN_STATUSES: ConversationStatus[] = ["ACTIVE", "WAITING_FOR_CUSTOMER", "QUOTE_PENDING", "QUOTE_APPROVAL", "HUMAN_REQUIRED"];

export async function findOrCreateConversation(actor: Actor, customerId: string, whatsappNumber: string) {
  const existing = await db.conversation.findFirst({
    where: { businessId: actor.businessId, customerId, status: { in: OPEN_STATUSES } },
    orderBy: { lastMessageAt: "desc" },
  });
  if (existing) return existing;

  // Carry the customer's most recent vehicle forward so returning customers are not re-interrogated.
  const lastConv = await db.conversation.findFirst({
    where: { businessId: actor.businessId, customerId, vehicleId: { not: null } },
    orderBy: { lastMessageAt: "desc" },
    select: { vehicleId: true },
  });
  return db.conversation.create({
    data: { businessId: actor.businessId, customerId, whatsappNumber, vehicleId: lastConv?.vehicleId ?? null },
  });
}

export async function recordInboundMessage(
  conversationId: string,
  input: { content: string; messageType?: MessageType; whatsappMessageId?: string; createdAt?: Date },
): Promise<{ message: Message; duplicate: boolean }> {
  if (input.whatsappMessageId) {
    const dup = await db.message.findUnique({ where: { whatsappMessageId: input.whatsappMessageId } });
    if (dup) return { message: dup, duplicate: true };
  }
  try {
    const message = await db.message.create({
      data: {
        conversationId,
        direction: "INBOUND",
        sender: "CUSTOMER",
        messageType: input.messageType ?? "TEXT",
        content: input.content,
        whatsappMessageId: input.whatsappMessageId,
        deliveryStatus: "RECEIVED",
        createdAt: input.createdAt,
      },
    });
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const reopen = conv.status === "WAITING_FOR_CUSTOMER" || conv.status === "QUOTE_PENDING";
    await db.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        unreadCount: { increment: 1 },
        ...(reopen ? { status: "ACTIVE" } : {}),
      },
    });
    return { message, duplicate: false };
  } catch (e) {
    // Unique violation on whatsappMessageId: Meta retried the webhook concurrently.
    if (input.whatsappMessageId) {
      const dup = await db.message.findUnique({ where: { whatsappMessageId: input.whatsappMessageId } });
      if (dup) return { message: dup, duplicate: true };
    }
    throw e;
  }
}

/** Internal note visible in the dashboard only; never sent to the customer. */
export async function addInternalNote(conversationId: string, content: string) {
  return db.message.create({
    data: {
      conversationId,
      direction: "OUTBOUND",
      sender: "SYSTEM",
      messageType: "NOTE",
      content,
      deliveryStatus: "SENT",
    },
  });
}

export interface SendOutcome {
  message: Message;
  sent: boolean;
  error?: string;
}

async function dispatchText(conversationId: string, messageId: string): Promise<SendOutcome> {
  const message = await db.message.findUniqueOrThrow({ where: { id: messageId } });
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { business: true } });
  try {
    const svc = getWhatsAppService();
    const creds = getCredentials(conv.business);
    const { messageId: waId } = await svc.sendMessage(creds, { to: conv.whatsappNumber, text: message.content });
    const updated = await db.message.update({
      where: { id: messageId },
      data: { deliveryStatus: "SENT", whatsappMessageId: waId, error: null },
    });
    await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
    return { message: updated, sent: true };
  } catch (e) {
    const err = errorMessage(e);
    const updated = await db.message.update({ where: { id: messageId }, data: { deliveryStatus: "FAILED", error: err } });
    return { message: updated, sent: false, error: err };
  }
}

/** Store an outbound text message, send it via WhatsApp, and record the outcome. */
export async function sendTextToCustomer(
  conversationId: string,
  input: { text: string; sender: Extract<MessageSender, "AI" | "BUSINESS"> },
): Promise<SendOutcome> {
  const message = await db.message.create({
    data: {
      conversationId,
      direction: "OUTBOUND",
      sender: input.sender,
      messageType: "TEXT",
      content: input.text,
      deliveryStatus: "PENDING",
    },
  });
  return dispatchText(conversationId, message.id);
}

export async function retryFailedMessage(actor: Actor, conversationId: string, messageId: string): Promise<SendOutcome> {
  const msg = await db.message.findFirst({
    where: { id: messageId, conversationId, conversation: { businessId: actor.businessId } },
  });
  if (!msg) throw new NotFoundError("Message");
  if (msg.deliveryStatus !== "FAILED" || msg.direction !== "OUTBOUND" || msg.messageType !== "TEXT") {
    throw new InvalidStateError("Only failed outbound text messages can be retried");
  }
  await db.message.update({ where: { id: msg.id }, data: { deliveryStatus: "PENDING", error: null } });
  const outcome = await dispatchText(conversationId, msg.id);
  await audit(actor, { action: "message.retry", entityType: "Message", entityId: msg.id, summary: outcome.sent ? "Message resent" : `Retry failed: ${outcome.error}` });
  return outcome;
}

/** Staff reply from the dashboard. Also takes over the conversation from the AI. */
export async function sendBusinessReply(actor: Actor, conversationId: string, text: string): Promise<SendOutcome> {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, businessId: actor.businessId } });
  if (!conv) throw new NotFoundError("Conversation");
  if (conv.handler !== "HUMAN") {
    await db.conversation.update({
      where: { id: conversationId },
      data: { handler: "HUMAN", ...(conv.status === "HUMAN_REQUIRED" ? { status: "ACTIVE" } : {}) },
    });
    await addInternalNote(conversationId, `${actor.kind === "user" ? actor.name ?? "Staff" : "Staff"} took over the conversation. Automated replies are paused.`);
  }
  return sendTextToCustomer(conversationId, { text, sender: "BUSINESS" });
}

export async function requestHuman(actor: Actor, conversationId: string, reason: string, opts: { note?: string } = {}) {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, businessId: actor.businessId } });
  if (!conv) throw new NotFoundError("Conversation");
  const updated = await db.conversation.update({
    where: { id: conversationId },
    data: { status: "HUMAN_REQUIRED", handler: "HUMAN", humanRequestedAt: new Date(), humanReason: reason },
  });
  await addInternalNote(conversationId, opts.note ?? `Customer requested human assistance: ${reason}`);
  await audit(actor, { action: "conversation.human_requested", entityType: "Conversation", entityId: conversationId, summary: `Human assistance requested: ${reason}` });
  return updated;
}

export async function resumeAi(actor: Actor, conversationId: string) {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, businessId: actor.businessId } });
  if (!conv) throw new NotFoundError("Conversation");
  const updated = await db.conversation.update({
    where: { id: conversationId },
    data: { handler: "AI", status: conv.status === "HUMAN_REQUIRED" ? "ACTIVE" : conv.status, humanRequestedAt: null, humanReason: null },
  });
  await addInternalNote(conversationId, "Automated replies resumed.");
  await audit(actor, { action: "conversation.resume_ai", entityType: "Conversation", entityId: conversationId, summary: "AI replies resumed" });
  return updated;
}

export async function takeOver(actor: Actor, conversationId: string) {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, businessId: actor.businessId } });
  if (!conv) throw new NotFoundError("Conversation");
  const updated = await db.conversation.update({
    where: { id: conversationId },
    data: { handler: "HUMAN", status: conv.status === "HUMAN_REQUIRED" ? "ACTIVE" : conv.status },
  });
  await addInternalNote(conversationId, "A team member took over. Automated replies are paused.");
  await audit(actor, { action: "conversation.take_over", entityType: "Conversation", entityId: conversationId, summary: "Conversation taken over by staff" });
  return updated;
}

export async function setConversationStatus(actor: Actor, conversationId: string, status: ConversationStatus) {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, businessId: actor.businessId } });
  if (!conv) throw new NotFoundError("Conversation");
  const updated = await db.conversation.update({ where: { id: conversationId }, data: { status } });
  await audit(actor, { action: "conversation.status", entityType: "Conversation", entityId: conversationId, summary: `Status ${conv.status} -> ${status}` });
  return updated;
}

export async function listConversations(
  businessId: string,
  opts: { q?: string; status?: ConversationStatus | "OPEN"; page?: number; pageSize?: number } = {},
) {
  const pageSize = Math.min(opts.pageSize ?? 40, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const q = opts.q?.trim();
  const where: Prisma.ConversationWhereInput = {
    businessId,
    ...(opts.status === "OPEN" ? { status: { in: OPEN_STATUSES } } : opts.status ? { status: opts.status } : {}),
    ...(q
      ? {
          OR: [
            { customer: { name: { contains: q, mode: "insensitive" } } },
            { customer: { phone: { contains: q } } },
            { vehicle: { make: { contains: q, mode: "insensitive" } } },
            { vehicle: { model: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        vehicle: { select: { id: true, year: true, make: true, model: true, variant: true, engine: true, vin: true } },
        messages: { where: { messageType: { not: "NOTE" } }, orderBy: { createdAt: "desc" }, take: 1 },
        quotations: { select: { id: true, quoteNumber: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.conversation.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getConversation(businessId: string, id: string, opts: { markRead?: boolean } = {}) {
  const conv = await db.conversation.findFirst({
    where: { id, businessId },
    include: {
      customer: true,
      vehicle: true,
      messages: { orderBy: { createdAt: "asc" }, take: 500 },
      quotations: { orderBy: { createdAt: "desc" }, select: { id: true, quoteNumber: true, status: true, total: true, sendError: true } },
      partRequests: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!conv) throw new NotFoundError("Conversation");
  if (opts.markRead && conv.unreadCount > 0) {
    await db.conversation.update({ where: { id }, data: { unreadCount: 0 } });
  }
  return conv;
}

export async function applyDeliveryStatus(whatsappMessageId: string, status: DeliveryStatus, error?: string) {
  const rank: Record<DeliveryStatus, number> = { RECEIVED: 0, PENDING: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5 };
  const msg = await db.message.findUnique({ where: { whatsappMessageId } });
  if (!msg) return null;
  // Delivery receipts can arrive out of order; never downgrade delivered/read to sent.
  if (status !== "FAILED" && rank[status] <= rank[msg.deliveryStatus] && msg.deliveryStatus !== "FAILED") return msg;
  return db.message.update({ where: { id: msg.id }, data: { deliveryStatus: status, error: status === "FAILED" ? error ?? "Delivery failed" : null } });
}
