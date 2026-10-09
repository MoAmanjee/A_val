import type { CancelledBy, OrderStatus, Prisma, Store } from "@prisma/client";
import { db } from "@/lib/db";
import { InvalidStateError } from "@/lib/errors";
import { sendToCustomer } from "@/services/conversations";
import {
  kitchenAcknowledgedMessage,
  orderCancelledMessage,
  orderCollectedMessage,
  orderPlacedMessage,
  orderReadyMessage,
} from "@/services/messaging/templates";
import { loadOrder, recalculate } from "@/services/orders/cart";
import { isReadyToConfirm, nextRequirement } from "@/services/orders/requirements";
import type { FullOrder } from "@/services/orders/query";
import { addMinutes, minutesBetween } from "@/utils/time";

/**
 * The order's life after the customer confirms it: numbering, the kitchen's
 * acknowledgement, and the messages that go back to the customer at each step.
 *
 * Every transition is written with an OrderEvent, so "what time will it be
 * ready?" and "who cancelled this?" are answered from recorded fact.
 */

/** Which statuses each status may move to. Guards against double-sends. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["AWAITING_CONFIRMATION", "SENT_TO_KITCHEN", "CANCELLED"],
  AWAITING_CONFIRMATION: ["DRAFT", "SENT_TO_KITCHEN", "CANCELLED"],
  SENT_TO_KITCHEN: ["ACKNOWLEDGED", "PREPARING", "CANCELLED", "REJECTED"],
  ACKNOWLEDGED: ["PREPARING", "READY_FOR_COLLECTION", "CANCELLED", "REJECTED"],
  PREPARING: ["READY_FOR_COLLECTION", "CANCELLED", "REJECTED"],
  READY_FOR_COLLECTION: ["COLLECTED", "CANCELLED"],
  COLLECTED: [],
  CANCELLED: [],
  REJECTED: [],
};

function assertTransition(order: FullOrder, to: OrderStatus) {
  if (order.status === to) throw new InvalidStateError(`Order is already ${to.toLowerCase().replace(/_/g, " ")}`);
  if (!TRANSITIONS[order.status].includes(to)) {
    throw new InvalidStateError(`An order that is ${order.status.toLowerCase().replace(/_/g, " ")} cannot become ${to.toLowerCase().replace(/_/g, " ")}`);
  }
}

async function recordEvent(orderId: string, status: OrderStatus, summary: string, actor: string, metadata?: Prisma.InputJsonValue) {
  await db.orderEvent.create({ data: { orderId, status, summary, actor, metadata } });
}

/**
 * Hand out the next order number for this store. The counter lives in its own
 * row and is bumped inside the database, so two customers confirming at the
 * same moment can never be given the same number.
 */
export async function nextOrderNumber(storeId: string): Promise<string> {
  const rows = await db.$queryRaw<{ prefix: string; seq: number }[]>`
    UPDATE order_sequences SET next = next + 1
    WHERE "storeId" = ${storeId}
    RETURNING prefix, next - 1 AS seq
  `;
  if (rows.length) {
    return `${rows[0].prefix}-${String(Number(rows[0].seq)).padStart(4, "0")}`;
  }
  // First order for a store that was created without a sequence row.
  await db.orderSequence.upsert({ where: { storeId }, create: { storeId, next: 2 }, update: {} });
  const created = await db.orderSequence.findUniqueOrThrow({ where: { storeId } });
  return `${created.prefix}-0001`;
}

export async function markAwaitingConfirmation(orderId: string): Promise<FullOrder> {
  const order = await recalculate(orderId);
  if (order.status === "AWAITING_CONFIRMATION") return order;
  assertTransition(order, "AWAITING_CONFIRMATION");
  await db.order.update({ where: { id: orderId }, data: { status: "AWAITING_CONFIRMATION" } });
  return loadOrder(orderId);
}

export async function backToDraft(orderId: string): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  if (order.status === "DRAFT") return order;
  assertTransition(order, "DRAFT");
  await db.order.update({ where: { id: orderId }, data: { status: "DRAFT" } });
  return loadOrder(orderId);
}

/**
 * The customer said yes. Give the order a number, put it on the kitchen screen
 * and tell the customer what happens next.
 */
export async function confirmOrder(orderId: string, opts: { notify?: boolean } = {}): Promise<FullOrder> {
  const priced = await recalculate(orderId);
  if (!priced.items.length) throw new InvalidStateError("There is nothing in the order yet");
  if (!isReadyToConfirm(priced)) {
    const missing = nextRequirement(priced);
    throw new InvalidStateError(
      missing?.kind === "MODIFIER"
        ? `${missing.item.nameSnapshot} still needs a ${missing.link.group.name.toLowerCase()} choice`
        : `We still need to know whether the ${missing?.item.nameSnapshot} is a meal`,
    );
  }
  if (!priced.fulfilment) throw new InvalidStateError("We still need to know whether this is collection or delivery");
  if (priced.fulfilment === "DELIVERY" && !priced.deliveryAddress?.trim()) {
    throw new InvalidStateError("We still need a street address for the delivery");
  }
  assertTransition(priced, "SENT_TO_KITCHEN");

  const orderNumber = priced.orderNumber ?? (await nextOrderNumber(priced.storeId));
  const prepMinutes = priced.store.defaultPrepMinutes;
  const confirmedAt = new Date();

  await db.order.update({
    where: { id: orderId },
    data: { orderNumber, status: "SENT_TO_KITCHEN", confirmedAt, quotedPrepMinutes: prepMinutes },
  });
  await recordEvent(orderId, "SENT_TO_KITCHEN", `Customer confirmed order ${orderNumber}`, "customer", { totalCents: priced.totalCents });
  await db.customer.update({
    where: { id: priced.customerId },
    data: { orderCount: { increment: 1 }, lastOrderAt: confirmedAt },
  });

  const order = await loadOrder(orderId);
  if (opts.notify !== false) {
    await sendToCustomer(order.conversationId, orderPlacedMessage(order, order.store, prepMinutes), "AI");
  }
  return order;
}

/** The kitchen has seen the ticket and committed to a collection time. */
export async function acknowledgeOrder(
  orderId: string,
  input: { prepMinutes?: number; by: string; notify?: boolean },
): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertTransition(order, "ACKNOWLEDGED");
  const prepMinutes = Math.max(1, Math.min(180, input.prepMinutes ?? order.store.defaultPrepMinutes));
  const acknowledgedAt = new Date();

  await db.order.update({
    where: { id: orderId },
    data: {
      status: "ACKNOWLEDGED",
      acknowledgedAt,
      acknowledgedBy: input.by,
      promisedReadyAt: addMinutes(acknowledgedAt, prepMinutes),
    },
  });
  await recordEvent(orderId, "ACKNOWLEDGED", `Kitchen accepted the order, ${prepMinutes} minutes`, input.by, { prepMinutes });

  const updated = await loadOrder(orderId);
  if (input.notify !== false) {
    await sendToCustomer(updated.conversationId, kitchenAcknowledgedMessage(updated, updated.store), "SYSTEM");
  }
  return updated;
}

export async function markPreparing(orderId: string, by: string): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertTransition(order, "PREPARING");
  await db.order.update({ where: { id: orderId }, data: { status: "PREPARING" } });
  await recordEvent(orderId, "PREPARING", "Kitchen started cooking", by);
  return loadOrder(orderId);
}

export async function markReady(orderId: string, by: string, opts: { notify?: boolean } = {}): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertTransition(order, "READY_FOR_COLLECTION");
  await db.order.update({ where: { id: orderId }, data: { status: "READY_FOR_COLLECTION", readyAt: new Date() } });
  await recordEvent(orderId, "READY_FOR_COLLECTION", "Order is ready for collection", by);

  const updated = await loadOrder(orderId);
  if (opts.notify !== false) {
    await sendToCustomer(updated.conversationId, orderReadyMessage(updated, updated.store), "SYSTEM");
  }
  return updated;
}

export async function markCollected(orderId: string, by: string, opts: { notify?: boolean } = {}): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertTransition(order, "COLLECTED");
  await db.order.update({ where: { id: orderId }, data: { status: "COLLECTED", collectedAt: new Date() } });
  await recordEvent(orderId, "COLLECTED", "Customer collected the order", by);

  const updated = await loadOrder(orderId);
  if (opts.notify !== false) {
    await sendToCustomer(updated.conversationId, orderCollectedMessage(updated, updated.store), "SYSTEM");
  }
  return updated;
}

export async function cancelOrder(
  orderId: string,
  input: { by: CancelledBy; reason?: string; actor?: string; notify?: boolean },
): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  const status: OrderStatus = input.by === "KITCHEN" && order.status !== "READY_FOR_COLLECTION" ? "REJECTED" : "CANCELLED";
  assertTransition(order, status);

  await db.order.update({
    where: { id: orderId },
    data: { status, cancelledAt: new Date(), cancelledBy: input.by, cancelReason: input.reason ?? null },
  });
  await recordEvent(orderId, status, `Cancelled by ${input.by.toLowerCase()}${input.reason ? `: ${input.reason}` : ""}`, input.actor ?? input.by.toLowerCase());

  const updated = await loadOrder(orderId);
  // A basket that was never confirmed has no number and the customer never saw
  // it as an order, so there is nothing to tell them about.
  if (input.notify !== false && updated.orderNumber) {
    await sendToCustomer(updated.conversationId, orderCancelledMessage(updated, input.reason ?? null, input.by === "KITCHEN"), "SYSTEM");
  }
  return updated;
}

// ---------------------------------------------------------------- Questions about an order

export interface CancelEligibility {
  allowed: boolean;
  /** True when only a staff member can still do it. */
  needsStaff: boolean;
  reason: string;
}

/**
 * Whether the customer may still cancel themselves. Once the kitchen is cooking,
 * cancelling costs the store food, so it is only allowed inside the grace window
 * and otherwise goes to staff.
 */
export function cancelEligibility(order: FullOrder, store: Pick<Store, "cancelGraceMinutes">, now = new Date()): CancelEligibility {
  switch (order.status) {
    case "DRAFT":
    case "AWAITING_CONFIRMATION":
      return { allowed: true, needsStaff: false, reason: "The order has not been sent to the kitchen yet." };
    case "SENT_TO_KITCHEN":
      return { allowed: true, needsStaff: false, reason: "The kitchen has not started on it yet." };
    case "ACKNOWLEDGED":
    case "PREPARING": {
      const since = order.acknowledgedAt ? minutesBetween(order.acknowledgedAt, now) : 0;
      if (since <= store.cancelGraceMinutes) {
        return { allowed: true, needsStaff: false, reason: "The kitchen only just started, so it can still be stopped." };
      }
      return { allowed: false, needsStaff: true, reason: "The kitchen is already cooking it, so a staff member needs to sort that out." };
    }
    case "READY_FOR_COLLECTION":
      return { allowed: false, needsStaff: true, reason: "The food is already made and waiting at the counter." };
    default:
      return { allowed: false, needsStaff: false, reason: `The order is already ${order.status.toLowerCase().replace(/_/g, " ")}.` };
  }
}

/** Best available answer to "what time will it be ready?". */
export function estimateReadyAt(order: FullOrder, store: Pick<Store, "defaultPrepMinutes">, now = new Date()): Date | null {
  if (order.status === "READY_FOR_COLLECTION" || order.status === "COLLECTED") return order.readyAt;
  if (order.promisedReadyAt) return order.promisedReadyAt;
  if (order.confirmedAt) return addMinutes(order.confirmedAt, order.quotedPrepMinutes ?? store.defaultPrepMinutes);
  return addMinutes(now, store.defaultPrepMinutes);
}

/** The order the customer would mean by "my order". */
export async function findActiveOrder(conversationId: string): Promise<FullOrder | null> {
  const row = await db.order.findFirst({
    where: {
      conversationId,
      status: { in: ["SENT_TO_KITCHEN", "ACKNOWLEDGED", "PREPARING", "READY_FOR_COLLECTION"] },
    },
    orderBy: { confirmedAt: "desc" },
    select: { id: true },
  });
  return row ? loadOrder(row.id) : null;
}

/** The most recent order of any kind, for "where is my order" after collection. */
export async function findLatestOrder(conversationId: string): Promise<FullOrder | null> {
  const row = await db.order.findFirst({
    where: { conversationId, orderNumber: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return row ? loadOrder(row.id) : null;
}
