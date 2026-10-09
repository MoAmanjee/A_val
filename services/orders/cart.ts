import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { InvalidStateError, NotFoundError } from "@/lib/errors";
import { lineTotalCents, orderTotals, type LineInput } from "@/services/orders/pricing";
import { ORDER_INCLUDE, type FullOrder, type FullOrderItem } from "@/services/orders/query";

/** Statuses where the basket is still the customer's to change. */
export const EDITABLE_STATUSES = ["DRAFT", "AWAITING_CONFIRMATION"] as const;

export async function loadOrder(orderId: string): Promise<FullOrder> {
  const order = await db.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
  if (!order) throw new NotFoundError("Order");
  return order;
}

/** The basket the customer is currently filling, if there is one. */
export async function findDraft(conversationId: string): Promise<FullOrder | null> {
  return db.order.findFirst({
    where: { conversationId, status: { in: [...EDITABLE_STATUSES] } },
    include: ORDER_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

export async function getOrCreateDraft(conversationId: string): Promise<FullOrder> {
  const existing = await findDraft(conversationId);
  if (existing) return existing;
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const created = await db.order.create({
    data: { storeId: conv.storeId, customerId: conv.customerId, conversationId, status: "DRAFT" },
  });
  return loadOrder(created.id);
}

function assertEditable(order: FullOrder) {
  if (!(EDITABLE_STATUSES as readonly string[]).includes(order.status)) {
    throw new InvalidStateError(`Order ${order.orderNumber ?? order.id} can no longer be changed (${order.status})`);
  }
}

export function toLineInput(item: FullOrderItem): LineInput {
  return {
    unitPriceCents: item.unitPriceCents,
    quantity: item.quantity,
    isMeal: item.isMeal,
    mealUpgradeCents: item.mealUpgradeCents,
    modifierDeltaCents: item.modifiers.map((m) => m.priceDeltaCents),
  };
}

/**
 * Rewrite every line total and the order total from the stored snapshots. Called
 * after any basket change so the number the customer confirms is the number the
 * kitchen and the till see.
 */
export async function recalculate(orderId: string): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  for (const item of order.items) {
    const total = lineTotalCents(toLineInput(item));
    if (total !== item.lineTotalCents) {
      await db.orderItem.update({ where: { id: item.id }, data: { lineTotalCents: total } });
    }
  }
  const totals = orderTotals(order.items.map(toLineInput));
  await db.order.update({ where: { id: orderId }, data: totals });
  return loadOrder(orderId);
}

export interface AddItemInput {
  menuItemId: string;
  quantity?: number;
  notes?: string;
  /** Pre-fills the meal answer when the customer already said "as a meal". */
  isMeal?: boolean;
}

/**
 * Put a menu item in the basket. Name and price are snapshotted onto the line so
 * a price change tonight cannot alter an order already taken. Modifier choices
 * are not set here: the flow engine asks for them.
 */
export async function addItem(orderId: string, input: AddItemInput): Promise<FullOrderItem> {
  const order = await loadOrder(orderId);
  assertEditable(order);

  const menuItem = await db.menuItem.findFirst({
    where: { id: input.menuItemId, storeId: order.storeId, active: true },
  });
  if (!menuItem) throw new NotFoundError("Menu item");
  if (!menuItem.available) {
    throw new InvalidStateError(menuItem.soldOutNote ?? `${menuItem.name} is sold out right now`);
  }

  const canBeMeal = menuItem.mealUpgradeCents !== null;
  const created = await db.orderItem.create({
    data: {
      orderId,
      menuItemId: menuItem.id,
      nameSnapshot: menuItem.name,
      unitPriceCents: menuItem.priceCents,
      quantity: Math.max(1, Math.min(50, input.quantity ?? 1)),
      notes: input.notes,
      mealUpgradeCents: menuItem.mealUpgradeCents ?? 0,
      // Items with no meal option are resolved immediately so the flow engine
      // never asks "would you like that as a meal?" about a can of Coke.
      isMeal: canBeMeal ? (input.isMeal ?? null) : false,
      sortOrder: order.items.length,
    },
  });
  await recalculate(orderId);
  const reloaded = await loadOrder(orderId);
  return reloaded.items.find((i) => i.id === created.id)!;
}

export async function removeItem(orderId: string, orderItemId: string): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertEditable(order);
  if (!order.items.some((i) => i.id === orderItemId)) throw new NotFoundError("Order item");
  await db.orderItem.delete({ where: { id: orderItemId } });
  return recalculate(orderId);
}

export async function setQuantity(orderId: string, orderItemId: string, quantity: number): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertEditable(order);
  if (!order.items.some((i) => i.id === orderItemId)) throw new NotFoundError("Order item");
  if (quantity <= 0) return removeItem(orderId, orderItemId);
  await db.orderItem.update({ where: { id: orderItemId }, data: { quantity: Math.min(50, quantity) } });
  return recalculate(orderId);
}

export async function clearItems(orderId: string): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertEditable(order);
  await db.orderItem.deleteMany({ where: { orderId } });
  return recalculate(orderId);
}

/**
 * Answer the meal-upgrade question for a line. Dropping back to a single item
 * also drops the side and drink, because those only exist inside a meal.
 */
export async function setMealUpgrade(orderId: string, orderItemId: string, isMeal: boolean): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertEditable(order);
  const item = order.items.find((i) => i.id === orderItemId);
  if (!item) throw new NotFoundError("Order item");
  if (isMeal && item.mealUpgradeCents === 0 && item.menuItem.mealUpgradeCents === null) {
    throw new InvalidStateError(`${item.nameSnapshot} does not come as a meal`);
  }

  if (!isMeal) {
    const mealGroupIds = item.menuItem.modifierLinks.filter((l) => l.scope === "MEAL_ONLY").map((l) => l.group.id);
    if (mealGroupIds.length) {
      await db.orderItemModifier.deleteMany({ where: { orderItemId, groupId: { in: mealGroupIds } } });
    }
  }
  await db.orderItem.update({ where: { id: orderItemId }, data: { isMeal } });
  return recalculate(orderId);
}

/**
 * Record the customer's answer to one modifier group. A single-choice group
 * replaces whatever was there before, so re-asking or changing a basting is
 * always safe; a multi-choice group is set to exactly the options given.
 */
export async function setModifierSelection(
  orderId: string,
  orderItemId: string,
  groupId: string,
  optionIds: string[],
): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertEditable(order);
  const item = order.items.find((i) => i.id === orderItemId);
  if (!item) throw new NotFoundError("Order item");

  const link = item.menuItem.modifierLinks.find((l) => l.modifierGroupId === groupId);
  if (!link) throw new InvalidStateError(`${item.nameSnapshot} has no "${groupId}" choice`);
  const group = link.group;

  const chosen = optionIds.map((id) => {
    const option = group.options.find((o) => o.id === id);
    if (!option) throw new NotFoundError(`Option for ${group.name}`);
    if (!option.available) throw new InvalidStateError(`${option.name} is not available right now`);
    return option;
  });

  const limit = group.selection === "SINGLE" ? 1 : Math.max(1, group.maxSelect);
  if (chosen.length > limit) {
    throw new InvalidStateError(`You can choose at most ${limit} for ${group.name}`);
  }
  if (chosen.length < group.minSelect) {
    throw new InvalidStateError(`Please choose at least ${group.minSelect} for ${group.name}`);
  }

  const data: Prisma.OrderItemModifierCreateManyInput[] = chosen.map((option) => ({
    orderItemId,
    groupId,
    optionId: option.id,
    groupNameSnapshot: group.name,
    optionNameSnapshot: option.name,
    priceDeltaCents: option.priceDeltaCents,
  }));

  await db.$transaction([
    db.orderItemModifier.deleteMany({ where: { orderItemId, groupId } }),
    ...(data.length ? [db.orderItemModifier.createMany({ data })] : []),
  ]);
  return recalculate(orderId);
}

export async function setItemNotes(orderId: string, orderItemId: string, notes: string | null): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertEditable(order);
  await db.orderItem.update({ where: { id: orderItemId }, data: { notes } });
  return loadOrder(orderId);
}

export async function setOrderNotes(orderId: string, notes: string | null): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertEditable(order);
  await db.order.update({ where: { id: orderId }, data: { notes } });
  return loadOrder(orderId);
}

/**
 * Collection or delivery. Collection clears any address. A delivery address is
 * only written when one is passed; tapping Delivery before the street is known
 * leaves the address empty so the flow can ask for it.
 */
export async function setFulfilment(
  orderId: string,
  fulfilment: "COLLECTION" | "DELIVERY",
  address?: string | null,
): Promise<FullOrder> {
  const order = await loadOrder(orderId);
  assertEditable(order);
  if (fulfilment === "COLLECTION") {
    await db.order.update({ where: { id: orderId }, data: { fulfilment: "COLLECTION", deliveryAddress: null } });
    return loadOrder(orderId);
  }
  const deliveryAddress = address === undefined ? order.deliveryAddress : address?.trim().slice(0, 240) || null;
  await db.order.update({ where: { id: orderId }, data: { fulfilment: "DELIVERY", deliveryAddress } });
  return loadOrder(orderId);
}
