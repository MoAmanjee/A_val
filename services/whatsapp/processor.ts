import type { MessageType, Store } from "@prisma/client";
import { db } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { getLLMClient, isLLMConfigured, runAgent, type LLMClient } from "@/services/ai";
import {
  addNote,
  applyDeliveryStatus,
  findOrCreateConversation,
  findOrCreateCustomer,
  handOverToHuman,
  recordInbound,
  sendToCustomer,
} from "@/services/conversations";
import { advanceFlow, applyReplyAction, askToConfirmCancel, handlePendingText } from "@/services/conversations/flow";
import { applyDictation } from "@/services/orders/dictate";
import { matchFaq } from "@/services/conversations/faq";
import { orderAsk, replyToOrderAsk } from "@/services/conversations/order-questions";
import { isGreeting, normalise, wantsCancel, wantsHuman, wantsMenu, wantsMenuPictures, wantsStatus } from "@/services/conversations/understanding";
import { getCategories, getStoreFaqs } from "@/services/menu";
import { sendMenuPictures } from "@/services/menu/images";
import { decodeReplyId, type ReplyAction } from "@/services/messaging/reply-ids";
import {
  categoryPickerMessage,
  closedMessage,
  FALLBACK_MESSAGE,
  HANDOVER_MESSAGE,
  MEDIA_MESSAGE,
  pausedMessage,
  welcomeMessage,
} from "@/services/messaging/templates";
import { findDraft } from "@/services/orders/cart";
import { findActiveOrder } from "@/services/orders/lifecycle";
import { getCredentials, getWhatsAppService, type InboundMessage, type StatusUpdate } from "@/services/whatsapp";
import { firstName } from "@/utils/phone";
import { isOpenAt } from "@/utils/time";

/**
 * Turning a webhook into a reply.
 *
 * The order of attempts matters, and it goes cheapest and most certain first:
 * a tapped button is applied directly, then a typed answer to the question we
 * just asked is read with the lexicon, then a greeting gets the menu, and only
 * what is left over costs an AI call. After the agent has had its turn the flow
 * engine sends whatever the order still needs.
 */

export interface ProcessSummary {
  messages: number;
  duplicates: number;
  unrouted: number;
  statuses: number;
  errors: string[];
}

const locks = new Map<string, Promise<unknown>>();

/**
 * Serialise processing per conversation so two rapid messages cannot both build
 * the same basket. Single-instance only; use a database advisory lock or Redis
 * when running more than one server.
 */
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
      return "TEXT";
    case "button":
    case "interactive":
      return "INTERACTIVE";
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
      const map = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" } as const;
      await applyDeliveryStatus(status.messageId, map[status.status], status.error);
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

export type ProcessOutcome = "processed" | "duplicate" | "unrouted";

export async function processInboundMessage(msg: InboundMessage, opts: { llm?: LLMClient } = {}): Promise<ProcessOutcome> {
  const store = msg.phoneNumberId ? await db.store.findUnique({ where: { whatsappPhoneNumberId: msg.phoneNumberId } }) : null;
  if (!store) {
    console.warn(`[whatsapp] no store is connected to phone number id "${msg.phoneNumberId}"`);
    return "unrouted";
  }

  const customer = await findOrCreateCustomer(store.id, msg.from, msg.profileName);
  const conversation = await findOrCreateConversation(store.id, customer.id, msg.from);

  const text = (msg.text ?? msg.caption ?? "").trim();
  const { duplicate } = await recordInbound(conversation.id, {
    content: text || `[${msg.type}]`,
    messageType: toMessageType(msg.type),
    whatsappMessageId: msg.messageId,
    ...(msg.interactiveId ? { payload: { replyId: msg.interactiveId } } : {}),
  });
  if (duplicate) return "duplicate";

  try {
    await getWhatsAppService().markAsRead(getCredentials(store), msg.messageId);
  } catch {
    // Read receipts are best effort.
  }

  await withConversationLock(conversation.id, async () => {
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id }, include: { store: true } });
    if (conv.handler === "HUMAN") return;

    // An earlier queued run may already have answered this message.
    const latestInbound = await db.message.findFirst({
      where: { conversationId: conv.id, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });
    if (!latestInbound) return;
    const alreadyAnswered = await db.message.findFirst({
      where: {
        conversationId: conv.id,
        direction: "OUTBOUND",
        sender: { in: ["AI", "STAFF"] },
        createdAt: { gt: latestInbound.createdAt },
      },
      select: { id: true },
    });
    if (alreadyAnswered) return;

    if (wantsHuman(text) || /\b(halaal|halal)\b/.test(normalise(text))) {
      await handOverToHuman(conv.id, `Customer said: "${text.slice(0, 160)}"`);
      await sendToCustomer(conv.id, HANDOVER_MESSAGE, "AI");
      return;
    }

    const draft = await findDraft(conv.id);
    const activeOrder = await findActiveOrder(conv.id);
    const hours = await db.tradingHour.findMany({ where: { storeId: conv.storeId }, orderBy: { dayOfWeek: "asc" } });
    const openState = isOpenAt(hours, new Date(), conv.store.timezone);
    const shopClosed = !openState.open && !activeOrder;
    const closedNote = openState.opensAt ? `we open again at ${openState.opensAt}.` : "we are closed for now.";

    // A tapped button carries exactly what it means. Browsing the menu is
    // allowed while closed; starting the order is not, until the shop opens.
    const action = decodeReplyId(msg.interactiveId);
    if (action) {
      if (shopClosed && startsAnOrder(action)) {
        await sendToCustomer(conv.id, closedMessage(conv.store, closedNote), "AI");
        return;
      }
      try {
        await applyReplyAction(conv, action);
      } catch (e) {
        console.error("[flow] reply action failed", e);
        await sendToCustomer(conv.id, { kind: "text", text: `Sorry, I could not do that \u2014 ${errorMessage(e)}` }, "AI");
        await advanceFlow(conv.id);
      }
      return;
    }

    if (!text) {
      await sendToCustomer(conv.id, MEDIA_MESSAGE, "AI");
      return;
    }

    if (!conv.store.acceptingOrders && !activeOrder) {
      await sendToCustomer(conv.id, pausedMessage(conv.store), "AI");
      return;
    }

    if (shopClosed) {
      await replyWhileClosed(conv.id, conv.store, text, closedNote);
      return;
    }

    // A typed order fills every slot it already names (item, flavour, meal,
    // drink, collection or delivery) so we only ask for the rest.
    try {
      const dictated = await applyDictation(conv.id, text);
      if (dictated.changed) {
        await advanceFlow(conv.id);
        return;
      }
    } catch (e) {
      console.error("[flow] could not read the typed order", e);
      await sendToCustomer(conv.id, { kind: "text", text: `Sorry, I could not add that \u2014 ${errorMessage(e)}` }, "AI");
      await advanceFlow(conv.id);
      return;
    }

    // A plain answer to the question we just asked ("ja", "hot", "no thats all").
    const handled = await handlePendingText(conv, text);
    if (handled?.sent) return;

    // "How long is my order?" and "can I cancel?" read the live ticket.
    // A general "how long does food take?" falls through to the shop FAQs.
    const ask = orderAsk(text);
    if (ask && (await replyToOrderAsk(conv.id, ask, text))) return;

    const faq = matchFaq(text, await getStoreFaqs(conv.storeId));
    if (faq) {
      await sendToCustomer(conv.id, { kind: "text", text: faq.answer }, "AI");
      if (wantsMenu(text) || wantsMenuPictures(text)) {
        await sendMenuToCustomer(conv.id, conv.storeId, { text });
      }
      if (draft?.items.length) await advanceFlow(conv.id);
      return;
    }

    // A greeting with nothing in the basket starts the order with the menu pictures
    // and then the tappable sections.
    if (!draft?.items.length && (isGreeting(text) || wantsMenu(text) || wantsMenuPictures(text))) {
      await sendMenuPictures(conv.id, {
        includePdf: /\bpdf\b/i.test(text),
        force: wantsMenuPictures(text),
        newOrder: true,
      });
      const categories = await getCategories(conv.storeId);
      const name = customer.name ?? firstName(customer.whatsappProfileName);
      await sendToCustomer(
        conv.id,
        isGreeting(text)
          ? welcomeMessage(conv.store, name, {
              returning: customer.orderCount > 0,
              openNote: openState.closesAt ? `Open until ${openState.closesAt} today` : undefined,
            })
          : categoryPickerMessage(conv.store, categories),
        "AI",
      );
      return;
    }

    if (wantsMenuPictures(text)) {
      await sendMenuPictures(conv.id, { includePdf: /\bpdf\b/i.test(text), force: true });
      if (text.length < 80) {
        await sendToCustomer(conv.id, { kind: "text", text: "There are the menu pages. Tell me what to add and I will put it together." }, "AI");
        return;
      }
    }

    if (!isLLMConfigured() && !opts.llm) {
      await handleWithoutAI(conv.id, conv.storeId, text);
      return;
    }

    let result;
    try {
      const llm = opts.llm ?? getLLMClient();
      result = await runAgent({ llm, ctx: { storeId: conv.storeId, conversationId: conv.id } });
    } catch (e) {
      // The customer gets a friendly message; staff get the real reason.
      console.error("[ai] agent failed", e);
      await handOverToHuman(conv.id, "The assistant was unavailable");
      await addNote(conv.id, `AI error (customer received a generic reply): ${errorMessage(e)}`);
      await sendToCustomer(conv.id, FALLBACK_MESSAGE, "AI");
      return;
    }

    if (result.stop) return;

    // Drop this reply if more messages arrived while thinking: the queued run
    // answers with the fuller picture.
    const newest = await db.message.findFirst({
      where: { conversationId: conv.id, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (newest && newest.id !== latestInbound.id) return;

    if (result.reply) {
      await sendToCustomer(conv.id, { kind: "text", text: result.reply }, "AI");
    }

    const advanced = await advanceFlow(conv.id);
    if (!advanced.sent && !result.reply) {
      // Nothing to say and nothing to ask: better a person than silence.
      await handOverToHuman(conv.id, "The assistant produced no reply");
      await sendToCustomer(conv.id, FALLBACK_MESSAGE, "AI");
    }
  });

  return "processed";
}

/**
 * Without an AI key the bot still works as a button-driven ordering flow: the
 * menu, the slot questions and the confirmation are all deterministic. An order
 * the bot cannot read still gets the menu, so the customer can tap it.
 */
async function handleWithoutAI(conversationId: string, storeId: string, text: string) {
  if (wantsMenu(text) || isGreeting(text) || wantsMenuPictures(text)) {
    await sendMenuToCustomer(conversationId, storeId, { text, body: "Here is our menu. What can we get you?" });
    return;
  }

  if (wantsCancel(text)) {
    const active = await findActiveOrder(conversationId);
    if (active) {
      await askToConfirmCancel(conversationId, active.id);
      return;
    }
  }

  if (wantsStatus(text)) {
    const active = await findActiveOrder(conversationId);
    if (active) {
      await handOverToHuman(conversationId, "Order question with no assistant available");
      await sendToCustomer(conversationId, HANDOVER_MESSAGE, "AI");
      return;
    }
  }

  const question = /^(do|does|can|could|what|whats|where|wheres|when|how|is|are|wat|waar|wanneer|hoe)\b|\?/.test(normalise(text));
  if (question) {
    await handOverToHuman(conversationId, "Free-text question with no assistant configured");
    await sendToCustomer(conversationId, HANDOVER_MESSAGE, "AI");
    return;
  }

  await sendMenuToCustomer(conversationId, storeId, {
    text,
    body: "Here is the menu, so you can see everything we have. Tap what you would like and I will take the order.",
  });
}

/** Pictures first, then the tappable list. The customer cannot order what they have not seen. */
async function sendMenuToCustomer(
  conversationId: string,
  storeId: string,
  opts: { text?: string; body?: string } = {},
) {
  const text = opts.text ?? "";
  await sendMenuPictures(conversationId, { includePdf: /\bpdf\b/i.test(text), force: wantsMenuPictures(text) });
  const categories = await getCategories(storeId);
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { store: true } });
  await sendToCustomer(conversationId, categoryPickerMessage(conv.store, categories, opts.body), "AI");
}

async function replyWhileClosed(conversationId: string, store: Store, text: string, closedNote: string) {
  const faq = matchFaq(text, await getStoreFaqs(store.id));
  const showMenu = !faq || isGreeting(text) || wantsMenu(text) || wantsMenuPictures(text);
  if (faq) {
    await sendToCustomer(conversationId, { kind: "text", text: `${faq.answer}\n\nWe are closed right now — ${closedNote}` }, "AI");
  } else {
    await sendToCustomer(conversationId, closedMessage(store, closedNote, { withMenu: showMenu }), "AI");
  }
  if (!showMenu) return;
  await sendMenuToCustomer(conversationId, store.id, {
    text,
    body: "Here is the menu. Have a look, and send the order once we are open.",
  });
}

function startsAnOrder(action: ReplyAction): boolean {
  return (
    action.kind === "item" ||
    action.kind === "modifier" ||
    action.kind === "modifierSkip" ||
    action.kind === "meal" ||
    action.kind === "anythingElse" ||
    action.kind === "fulfilment" ||
    action.kind === "confirm"
  );
}
