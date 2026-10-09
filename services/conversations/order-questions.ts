import { db } from "@/lib/db";
import { handOverToHuman, sendToCustomer } from "@/services/conversations";
import { askToConfirmCancel } from "@/services/conversations/flow";
import { normalise, wantsCancel, wantsStatus } from "@/services/conversations/understanding";
import { formatCents } from "@/utils/money";
import { formatClock } from "@/utils/time";
import { findDraft } from "@/services/orders/cart";
import {
  cancelEligibility,
  cancelOrder,
  estimateReadyAt,
  findActiveOrder,
  findLatestOrder,
  type CancelEligibility,
} from "@/services/orders/lifecycle";
import type { FullOrder } from "@/services/orders/query";

export type OrderAsk = "status" | "cancel" | "change" | "basket";

const CANCEL_POLICY =
  "You can cancel in this chat before the kitchen starts, and for a few minutes after they accept it. Once they are cooking, or the food is already ready, a person at the shop has to sort it out. Say cancel when you have an order and I will check.";

/**
 * A question about the customer's own order, as opposed to a shop fact.
 * "How long are you open?" stays a shop question. "How long is my order?" does not.
 */
export function orderAsk(raw: string): OrderAsk | null {
  const text = normalise(raw);
  if (!text) return null;
  if (/\b(open|close|hours|trading)\b/.test(text) && !/\border\b/.test(text)) return null;
  if (wantsCancel(text)) return "cancel";
  if (/\b(change|edit|update|fix|swap)\b/.test(text) && /\b(order|it|basket|item)\b/.test(text)) return "change";
  if (/\b(my total|what do i owe|how much is my order|whats in my order|what is in my order|whats my order)\b/.test(text)) {
    return "basket";
  }
  if (wantsStatus(text) || /\b(how long|eta)\b/.test(text)) return "status";
  return null;
}

/**
 * True when the customer is asking about their own ticket.
 * "How long does an order take?" is the general shop answer, so this stays false
 * and the FAQ can reply when there is nothing in the kitchen.
 */
export function isOwnOrderStatus(raw: string): boolean {
  const text = normalise(raw);
  if (/\b(my order|my food|ready yet|order status|any update|still waiting|order update|hoe lank|is dit gereed)\b/.test(text)) {
    return true;
  }
  if (/\b(is (?:it|my order) ready|when will|what time will|how much longer)\b/.test(text)) return true;
  if (/\bhow long\b/.test(text) && /\b(my|mine)\b/.test(text)) return true;
  return false;
}

export function describeOrderStatus(order: FullOrder, readyAt: Date | null): string {
  const number = order.orderNumber ? `*${order.orderNumber}*` : "Your order";
  const delivering = order.fulfilment === "DELIVERY";
  const when = readyAt ? formatClock(readyAt, order.store.timezone) : null;

  switch (order.status) {
    case "DRAFT":
    case "AWAITING_CONFIRMATION":
      return `Nothing is with the kitchen yet. The basket is *${formatCents(order.totalCents, order.store.currencySymbol)}*. Confirm it when I show you the total.`;
    case "SENT_TO_KITCHEN":
      return when
        ? `${number} is with the kitchen, waiting for them to accept it. About *${when}* if they start now — I'll message you when they do.`
        : `${number} is with the kitchen, waiting for them to accept it.`;
    case "ACKNOWLEDGED":
    case "PREPARING":
      return when
        ? `The kitchen has started on ${number}. It should be ${delivering ? "on the way" : "ready to collect"} at about *${when}*.`
        : `The kitchen has started on ${number}.`;
    case "READY_FOR_COLLECTION":
      return delivering
        ? `${number} is on its way${order.deliveryAddress ? ` to ${order.deliveryAddress}` : ""}. Pay the driver when it arrives.`
        : `${number} is ready to collect at ${order.store.addressLine}. Pay at the till.`;
    case "COLLECTED":
      return delivering ? `${number} has been delivered.` : `${number} has been collected.`;
    case "CANCELLED":
      return `${number} was cancelled. Nothing is due on it.`;
    default:
      return `${number} is ${order.status.toLowerCase().replace(/_/g, " ")}.`;
  }
}

export function describeCancel(eligibility: CancelEligibility): string {
  if (eligibility.allowed) return eligibility.reason;
  return `${eligibility.reason} I've passed this to the shop.`;
}

const NO_ORDER =
  "You don't have an order with the kitchen yet. Tell me what you'd like, or tap the menu, and I'll build it.";

/** Answer from the live ticket. False lets a general shop FAQ take the question. */
export async function replyToOrderAsk(conversationId: string, ask: OrderAsk, raw = ""): Promise<boolean> {
  const active = await findActiveOrder(conversationId);
  const draft = await findDraft(conversationId);
  const latest = active ?? (await findLatestOrder(conversationId));

  if (ask === "status") {
    const open = active ?? (draft?.items.length ? draft : null);
    if (open) {
      const readyAt = estimateReadyAt(open, open.store);
      await sendToCustomer(conversationId, { kind: "text", text: describeOrderStatus(open, readyAt) }, "AI");
      return true;
    }
    if (!isOwnOrderStatus(raw)) return false;
    if (latest) {
      const readyAt = estimateReadyAt(latest, latest.store);
      await sendToCustomer(conversationId, { kind: "text", text: describeOrderStatus(latest, readyAt) }, "AI");
      return true;
    }
    await sendToCustomer(conversationId, { kind: "text", text: NO_ORDER }, "AI");
    return true;
  }

  if (ask === "basket") {
    const order = draft ?? active ?? latest;
    if (!order || !order.items.length) {
      await sendToCustomer(conversationId, { kind: "text", text: "You don't have an order open yet. Tell me what you'd like, or tap the menu." }, "AI");
      return true;
    }
    const lines = order.items.map((item) => `${item.quantity} × ${item.nameSnapshot}`).join(", ");
    const total = formatCents(order.totalCents, order.store.currencySymbol);
    await sendToCustomer(conversationId, { kind: "text", text: `So far: ${lines}. Total *${total}*.` }, "AI");
    return true;
  }

  if (ask === "change") {
    if (draft?.items.length && !active) {
      await sendToCustomer(
        conversationId,
        { kind: "text", text: "Tell me the change in one message, like \"make the burger mild\" or \"remove the chips\". You can change it until you tap yes." },
        "AI",
      );
      return true;
    }
    if (active) {
      const eligibility = cancelEligibility(active, active.store);
      if (!eligibility.allowed) {
        await handOverToHuman(conversationId, "Customer wants to change an order the kitchen is already making");
        await sendToCustomer(conversationId, { kind: "text", text: `${eligibility.reason} I've asked someone at the shop to help with the change.` }, "AI");
        return true;
      }
      await sendToCustomer(
        conversationId,
        { kind: "text", text: "I can still stop it. Say cancel if you want the whole order dropped. A change to one item, once the kitchen has it, needs a person — say if you want me to call them." },
        "AI",
      );
      return true;
    }
    await sendToCustomer(conversationId, { kind: "text", text: "Send the order and I'll build it. You can change anything until you tap yes." }, "AI");
    return true;
  }

  if (draft?.items.length && !active) {
    await cancelOrder(draft.id, { by: "CUSTOMER", reason: "Customer cancelled the basket before it went to the kitchen", actor: "customer", notify: false });
    await db.conversation.update({ where: { id: conversationId }, data: { pendingQuestion: "NONE", askedAnythingElse: false } });
    await sendToCustomer(conversationId, { kind: "text", text: "No problem, I've cleared that basket. Message me when you want to start again." }, "AI");
    return true;
  }

  if (!active) {
    await sendToCustomer(conversationId, { kind: "text", text: CANCEL_POLICY }, "AI");
    return true;
  }

  const eligibility = cancelEligibility(active, active.store);
  if (!eligibility.allowed) {
    await handOverToHuman(conversationId, "Customer wants to cancel and the grace window has passed");
    await sendToCustomer(conversationId, { kind: "text", text: describeCancel(eligibility) }, "AI");
    return true;
  }
  await askToConfirmCancel(conversationId, active.id);
  return true;
}
