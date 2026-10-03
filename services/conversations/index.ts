import { Prisma, type Conversation, type MessageSender, type MessageType, type PendingQuestion } from "@prisma/client";
import { db } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { getCredentials, getWhatsAppService, type OutboundMessage } from "@/services/whatsapp";
import { normalizePhone } from "@/utils/phone";

export interface InboundRecord {
  content: string;
  messageType: MessageType;
  whatsappMessageId: string;
  payload?: Prisma.InputJsonValue;
}

export async function findOrCreateCustomer(storeId: string, rawPhone: string, profileName?: string) {
  const phone = normalizePhone(rawPhone);
  const existing = await db.customer.findUnique({ where: { storeId_phone: { storeId, phone } } });
  if (existing) {
    // The WhatsApp profile name can change; keep the latest one for greetings.
    if (profileName && profileName !== existing.whatsappProfileName) {
      return db.customer.update({ where: { id: existing.id }, data: { whatsappProfileName: profileName } });
    }
    return existing;
  }
  return db.customer.create({ data: { storeId, phone, whatsappProfileName: profileName ?? null } });
}

export async function findOrCreateConversation(storeId: string, customerId: string, rawPhone: string): Promise<Conversation> {
  const phone = normalizePhone(rawPhone);
  const existing = await db.conversation.findUnique({ where: { storeId_phone: { storeId, phone } } });
  if (existing) return existing;
  return db.conversation.create({ data: { storeId, customerId, phone } });
}

/**
 * Meta retries webhooks, so the same message can arrive several times. The
 * WhatsApp message id is unique in the database and that constraint is what
 * makes processing idempotent - never the absence of a retry.
 */
export async function recordInbound(conversationId: string, input: InboundRecord): Promise<{ duplicate: boolean }> {
  const existing = await db.message.findUnique({ where: { whatsappMessageId: input.whatsappMessageId }, select: { id: true } });
  if (existing) return { duplicate: true };
  try {
    await db.message.create({
      data: {
        conversationId,
        direction: "INBOUND",
        sender: "CUSTOMER",
        messageType: input.messageType,
        content: input.content,
        payload: input.payload,
        whatsappMessageId: input.whatsappMessageId,
        deliveryStatus: "DELIVERED",
      },
    });
  } catch (e) {
    // Unique violation: a concurrent delivery of the same message won the race.
    if ((e as { code?: string }).code === "P2002") return { duplicate: true };
    throw e;
  }
  await db.conversation.update({ where: { id: conversationId }, data: { lastInboundAt: new Date() } });
  return { duplicate: false };
}

/** Readable transcript line for an interactive message, used in chat history. */
export function describeOutbound(message: OutboundMessage): string {
  if (message.kind === "text") return message.text;
  if (message.kind === "image") return message.caption ? `[Image] ${message.caption}` : "[Image]";
  if (message.kind === "document") return message.caption ? `[Document] ${message.caption}` : `[Document] ${message.filename}`;
  const options =
    message.kind === "buttons"
      ? message.buttons.map((b) => b.title)
      : message.sections.flatMap((s) => s.rows.map((r) => r.title));
  return options.length ? `${message.body}\n[Options: ${options.join(" | ")}]` : message.body;
}

function outboundMessageType(message: OutboundMessage): MessageType {
  if (message.kind === "text") return "TEXT";
  if (message.kind === "image") return "IMAGE";
  if (message.kind === "document") return "DOCUMENT";
  return "INTERACTIVE";
}

export interface SendOutcome {
  sent: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Persist an outbound message then hand it to WhatsApp. It is written first so
 * a failed send is still visible to staff instead of vanishing.
 */
export async function sendToCustomer(
  conversationId: string,
  message: OutboundMessage,
  sender: MessageSender = "AI",
): Promise<SendOutcome> {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { store: true } });
  const row = await db.message.create({
    data: {
      conversationId,
      direction: "OUTBOUND",
      sender,
      messageType: outboundMessageType(message),
      content: describeOutbound(message),
      payload: message as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    const result = await getWhatsAppService().send(getCredentials(conv.store), conv.phone, message);
    await db.message.update({
      where: { id: row.id },
      data: { whatsappMessageId: result.messageId, deliveryStatus: "SENT" },
    });
    await db.conversation.update({ where: { id: conversationId }, data: { lastOutboundAt: new Date() } });
    return { sent: true, messageId: result.messageId };
  } catch (e) {
    const error = errorMessage(e);
    console.error("[whatsapp] send failed", e);
    await db.message.update({ where: { id: row.id }, data: { deliveryStatus: "FAILED", error } });
    return { sent: false, error };
  }
}

export async function addNote(conversationId: string, content: string) {
  await db.message.create({
    data: { conversationId, direction: "OUTBOUND", sender: "SYSTEM", messageType: "NOTE", content, deliveryStatus: "PENDING" },
  });
}

export async function applyDeliveryStatus(whatsappMessageId: string, status: "SENT" | "DELIVERED" | "READ" | "FAILED", error?: string) {
  await db.message.updateMany({
    where: { whatsappMessageId },
    data: { deliveryStatus: status, ...(error ? { error } : {}) },
  });
}

export async function setPendingQuestion(
  conversationId: string,
  pendingQuestion: PendingQuestion,
  pendingContext?: Prisma.InputJsonValue | null,
) {
  await db.conversation.update({
    where: { id: conversationId },
    data: { pendingQuestion, pendingContext: pendingContext ?? Prisma.DbNull },
  });
}

/** Take the bot out of the loop and put the chat in the staff queue. */
export async function handOverToHuman(conversationId: string, reason: string) {
  await db.conversation.update({
    where: { id: conversationId },
    data: { handler: "HUMAN", handoverReason: reason, pendingQuestion: "NONE", pendingContext: Prisma.DbNull },
  });
  await addNote(conversationId, `Handed to staff: ${reason}`);
}

export async function returnToBot(conversationId: string) {
  await db.conversation.update({
    where: { id: conversationId },
    data: { handler: "AI", handoverReason: null },
  });
}
