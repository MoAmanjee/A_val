import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { InvalidStateError, NotFoundError } from "@/lib/errors";
import {
  addItem,
  loadOrder,
  setFulfilment,
  setMealUpgrade,
  setModifierSelection,
  setOrderNotes,
} from "@/services/orders/cart";
import { confirmOrder } from "@/services/orders/lifecycle";
import { DELIVERY_ENABLED } from "@/services/orders/features";
import type { FullOrder } from "@/services/orders/query";
import { isReadyToConfirm } from "@/services/orders/requirements";
import { assertPaidIntent } from "@/services/orders/web-payment";
import { tenantGate } from "@/services/ops/tenant";
import { stripeConfigured } from "@/lib/stripe";
import { normalizePhone } from "@/utils/phone";

export interface WebLineChoice {
  groupId: string;
  optionIds: string[];
}

export interface WebCartLine {
  menuItemId: string;
  quantity: number;
  /** null = item cannot be a meal / already resolved. */
  isMeal?: boolean | null;
  modifiers: WebLineChoice[];
  notes?: string;
}

export type OnlineWalletChoice = "apple_pay" | "samsung_pay" | "google_pay" | "card";

export interface WebCheckoutInput {
  phone: string;
  name?: string;
  notes?: string;
  fulfilment?: "COLLECTION" | "DELIVERY";
  deliveryAddress?: string;
  deliveryNotes?: string;
  lines: WebCartLine[];
  /** When set, order is only placed after this Stripe PaymentIntent has succeeded. */
  paymentIntentId?: string;
  /**
   * Pay-online without a Stripe intent — only accepted when Stripe keys are not
   * configured (local demo). With live Stripe, use paymentIntentId instead.
   */
  onlineWallet?: OnlineWalletChoice;
}

/**
 * Turn a mini-site cart into the same Order row the WhatsApp bot and kitchen
 * already use. Creates / reuses the customer + conversation so later WhatsApp
 * status updates still reach them.
 */
export async function placeWebOrder(input: WebCheckoutInput): Promise<FullOrder> {
  const phone = normalizePhone(input.phone);
  if (phone.length < 10 || phone.length > 15) {
    throw new InvalidStateError("Please enter a valid South African mobile number");
  }
  if (!input.lines.length) throw new InvalidStateError("Your cart is empty");

  const store = await db.store.findFirst({ orderBy: { createdAt: "asc" } });
  if (!store) throw new NotFoundError("Store");
  const gate = tenantGate(store, "web");
  if (!gate.ok) {
    throw new InvalidStateError(gate.reason ?? "Online ordering is unavailable right now");
  }

  const customer = await db.customer.upsert({
    where: { storeId_phone: { storeId: store.id, phone } },
    create: {
      storeId: store.id,
      phone,
      name: input.name?.trim().slice(0, 80) || null,
    },
    update: {
      name: input.name?.trim().slice(0, 80) || undefined,
    },
  });

  const conversation = await db.conversation.upsert({
    where: { storeId_phone: { storeId: store.id, phone } },
    create: {
      storeId: store.id,
      customerId: customer.id,
      phone,
      pendingQuestion: "NONE",
    },
    update: {
      customerId: customer.id,
      pendingQuestion: "NONE",
      pendingContext: Prisma.DbNull,
      askedAnythingElse: false,
    },
  });

  // Drop any abandoned web/chat draft so the mini-site starts clean.
  await db.order.deleteMany({
    where: {
      conversationId: conversation.id,
      status: { in: ["DRAFT", "AWAITING_CONFIRMATION"] },
    },
  });

  const draft = await db.order.create({
    data: {
      storeId: store.id,
      customerId: customer.id,
      conversationId: conversation.id,
      status: "DRAFT",
    },
  });

  for (const line of input.lines) {
    const item = await addItem(draft.id, {
      menuItemId: line.menuItemId,
      quantity: line.quantity,
      notes: line.notes,
      isMeal: line.isMeal ?? undefined,
    });

    if (typeof line.isMeal === "boolean") {
      await setMealUpgrade(draft.id, item.id, line.isMeal);
    }

    for (const choice of line.modifiers) {
      if (!choice.optionIds.length) continue;
      await setModifierSelection(draft.id, item.id, choice.groupId, choice.optionIds);
    }

    // Web checkout always resolves leave-outs (order-level note covers the rest).
    await db.orderItem.update({
      where: { id: item.id },
      data: { notesOffered: true },
    });
  }

  const fulfilment = !DELIVERY_ENABLED
    ? "COLLECTION"
    : input.fulfilment === "DELIVERY"
      ? "DELIVERY"
      : "COLLECTION";

  await setFulfilment(draft.id, fulfilment, input.deliveryAddress, {
    notes: input.deliveryNotes,
  });

  await setOrderNotes(draft.id, input.notes?.trim().slice(0, 500) || null);

  // Ensure every line that can be a meal has an answer.
  let order = await loadOrder(draft.id);
  for (const item of order.items) {
    if (item.isMeal === null && item.menuItem.mealUpgradeCents !== null) {
      throw new InvalidStateError(`Choose meal or on its own for ${item.nameSnapshot}`);
    }
  }

  if (!isReadyToConfirm(order)) {
    throw new InvalidStateError("Some items still need a flavour, size, or meal choice");
  }

  // Re-load totals after modifiers / meal upgrades so Stripe amount matches.
  order = await loadOrder(draft.id);

  if (input.paymentIntentId) {
    const existing = await db.order.findFirst({
      where: { stripePaymentIntentId: input.paymentIntentId, status: { not: "DRAFT" } },
    });
    if (existing) {
      throw new InvalidStateError("This payment was already used for an order");
    }

    const { method } = await assertPaidIntent(input.paymentIntentId, order.totalCents);
    await db.order.update({
      where: { id: draft.id },
      data: {
        paymentStatus: "PAID",
        paymentMethod: method,
        stripePaymentIntentId: input.paymentIntentId,
      },
    });
  } else if (input.onlineWallet) {
    // Live Stripe must confirm a PaymentIntent — wallet label alone is not enough.
    if (stripeConfigured()) {
      throw new InvalidStateError("Finish Apple Pay / Samsung Pay / card in the payment sheet first");
    }
    await db.order.update({
      where: { id: draft.id },
      data: {
        paymentStatus: "PAID",
        paymentMethod: input.onlineWallet,
      },
    });
  } else {
    await db.order.update({
      where: { id: draft.id },
      data: {
        paymentStatus: "UNPAID",
        paymentMethod: "collection",
      },
    });
  }

  order = await confirmOrder(draft.id, { notify: true });
  return order;
}
