import { Prisma, type Conversation } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { errorMessage } from "@/lib/errors";
import { handOverToHuman, sendToCustomer, setPendingQuestion } from "@/services/conversations";
import { readAnythingElse, readConfirmation, readFulfilment, wantsCancel } from "@/services/conversations/understanding";
import { getCategories, getCategoryItems, isDecisive, rankByName } from "@/services/menu";
import { sendMenuPictures } from "@/services/menu/images";
import type { ReplyAction } from "@/services/messaging/reply-ids";
import {
  categoryItemsMessage,
  categoryPickerMessage,
  cancelConfirmMessage,
  changeRequestMessage,
  COLLECTION_ONLY_MESSAGE,
  confirmationMessages,
  deliveryAddressMessage,
  deliveryNoteMessage,
  itemNotesMessage,
  DRAFT_CANCELLED_MESSAGE,
  fulfilmentMessage,
  HANDOVER_MESSAGE,
  KEEP_ORDER_MESSAGE,
  interactiveBasket,
  mealUpgradeMessage,
  onlineMenuMessage,
  orderProgressMessages,
  modifierQuestionMessage,
  STALE_TAP_MESSAGE,
  TYPE_ORDER_MESSAGE,
} from "@/services/messaging/templates";
import { addItem, findDraft, getOrCreateDraft, setDeliveryNotes, setFulfilment, setItemNotes, setMealUpgrade, setModifierSelection } from "@/services/orders/cart";
import { isSkippedDriverNote, parseDeliveryText, pinLabel } from "@/services/orders/delivery-text";
import { isSkippedItemNote } from "@/services/orders/item-notes";
import { DELIVERY_ENABLED } from "@/services/orders/features";
import { backToDraft, cancelOrder, confirmOrder, findActiveOrder, markAwaitingConfirmation } from "@/services/orders/lifecycle";
import { nextRequirement } from "@/services/orders/requirements";

/**
 * The ordering flow.
 *
 * The bot asks the questions, not the language model. After anything changes
 * the basket - a tapped button, or an item the model understood from free text -
 * `advanceFlow` looks at what the order still needs and sends exactly one
 * question for it, with buttons whose ids map straight back to the item and
 * choice they belong to. A typed order that already named the flavour, the
 * meal and the drink skips those questions.
 *
 * That split is the reason the flow is reliable: prices, totals and the
 * confirmation summary are rendered from the database, the questions come in a
 * fixed order, and the model is left to do the part it is good at, which is
 * working out what the customer meant.
 */

export interface FlowResult {
  /** True when the flow sent something, so the caller should not also reply. */
  sent: boolean;
}

/**
 * Send the next thing the order needs: a modifier question, the meal upgrade,
 * the same section again so they can tap the next item, or the confirmation summary.
 */
export async function advanceFlow(conversationId: string): Promise<FlowResult> {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { store: true } });
  const order = await findDraft(conversationId);

  if (!order || order.items.length === 0) {
    await setPendingQuestion(conversationId, "NONE");
    return { sent: false };
  }

  const requirement = nextRequirement(order);
  if (requirement) {
    if (requirement.kind === "MODIFIER") {
      await sendToCustomer(conversationId, modifierQuestionMessage(order, requirement.item, requirement.link, conv.store), "AI");
      await setPendingQuestion(conversationId, "MODIFIER", {
        orderItemId: requirement.item.id,
        modifierGroupId: requirement.link.modifierGroupId,
      });
    } else if (requirement.kind === "ITEM_NOTES") {
      await sendToCustomer(conversationId, itemNotesMessage(requirement.item), "AI");
      await setPendingQuestion(conversationId, "ITEM_NOTES", { orderItemId: requirement.item.id });
    } else {
      await sendToCustomer(conversationId, mealUpgradeMessage(order, requirement.item, conv.store), "AI");
      await setPendingQuestion(conversationId, "MEAL_UPGRADE", { orderItemId: requirement.item.id });
    }
    return { sent: true };
  }

  if (!conv.askedAnythingElse) {
    await sendKeepAdding(conversationId, order);
    return { sent: true };
  }

  // Delivery is commented out for now. The question below stays so it can be switched back on.
  if (!DELIVERY_ENABLED) {
    if (order.fulfilment !== "COLLECTION") await setFulfilment(order.id, "COLLECTION");
    return askForConfirmation(conversationId);
  }

  if (!order.fulfilment) {
    await sendToCustomer(conversationId, fulfilmentMessage(conv.store), "AI");
    await setPendingQuestion(conversationId, "FULFILMENT", { orderId: order.id });
    return { sent: true };
  }

  if (order.fulfilment === "DELIVERY" && !order.deliveryAddress?.trim()) {
    await sendToCustomer(conversationId, deliveryAddressMessage(conv.store), "AI");
    await setPendingQuestion(conversationId, "DELIVERY_ADDRESS", { orderId: order.id });
    return { sent: true };
  }

  return askForConfirmation(conversationId);
}

async function askForConfirmation(conversationId: string): Promise<FlowResult> {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { store: true } });
  const order = await markAwaitingConfirmation((await findDraft(conversationId))!.id);
  for (const message of confirmationMessages(order, conv.store, conv.store.defaultPrepMinutes)) {
    await sendToCustomer(conversationId, message, "AI");
  }
  await setPendingQuestion(conversationId, "ORDER_CONFIRMATION", { orderId: order.id });
  return { sent: true };
}

/** Back to a clean slate once an order is confirmed or dropped. */
async function resetConversation(conversationId: string) {
  await db.conversation.update({
    where: { id: conversationId },
    data: { pendingQuestion: "NONE", pendingContext: Prisma.DbNull, askedAnythingElse: false },
  });
}

/** Section list. An open basket stays on this list, with Collect and Delivery at the bottom. */
async function sendSectionList(conversationId: string, storeId: string, fallbackBody?: string, page = 0) {
  const draft = await findDraft(conversationId);
  const open = Boolean(draft && draft.items.length > 0 && !nextRequirement(draft));
  if (open && draft) {
    await sendAddingSections(conversationId, draft, page);
    return;
  }
  await sendMenu(conversationId, storeId, fallbackBody, false);
}

async function sendMenu(conversationId: string, storeId: string, body?: string, checkout = false) {
  const categories = await getCategories(storeId);
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { store: true } });
  await sendToCustomer(conversationId, categoryPickerMessage(conv.store, categories, body, { checkout }), "AI");
  await setPendingQuestion(conversationId, checkout ? "ANYTHING_ELSE" : "NONE");
}

/**
 * After an item is complete, show Confirm order, Add to order, and Cancel order.
 * Add to order opens the sections. Confirm order goes to the receipt.
 * Delivery is switched off, so the receipt is collection.
 */
async function sendKeepAdding(conversationId: string, order: NonNullable<Awaited<ReturnType<typeof findDraft>>>) {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { store: true } });
  for (const message of orderProgressMessages(order, conv.store)) {
    await sendToCustomer(conversationId, message, "AI");
  }
  await setPendingQuestion(conversationId, "ANYTHING_ELSE");
}

async function sendAddingSections(
  conversationId: string,
  order: NonNullable<Awaited<ReturnType<typeof findDraft>>>,
  page: number,
) {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { store: true } });
  const categories = await getCategories(conv.storeId);
  await sendToCustomer(
    conversationId,
    categoryPickerMessage(conv.store, categories, interactiveBasket(order, conv.store), { checkout: true, page }),
    "AI",
  );
  await setPendingQuestion(conversationId, "ANYTHING_ELSE");
}

/** True when the customer already sent something newer than the tap we are answering. */
async function hasNewerInbound(conversationId: string, inboundAt: Date): Promise<boolean> {
  const newer = await db.message.findFirst({
    where: { conversationId, direction: "INBOUND", createdAt: { gt: inboundAt } },
    select: { id: true },
  });
  return newer !== null;
}

/**
 * A later tap will send the question. If the basket is waiting on a leave-out
 * note, remember that so "no tomato" is saved instead of being read as food.
 */
async function rememberNotesIfThatIsNext(conversationId: string) {
  const order = await findDraft(conversationId);
  const requirement = order ? nextRequirement(order) : null;
  if (requirement?.kind === "ITEM_NOTES") {
    await setPendingQuestion(conversationId, "ITEM_NOTES", { orderItemId: requirement.item.id });
  }
}

// ---------------------------------------------------------------- Tapped replies

/**
 * Apply a button or list reply. These never go near the language model: the id
 * carries the item and the choice, so the only thing that can go wrong is the
 * customer tapping something that has since been removed, which is reported
 * back plainly.
 */
export async function applyReplyAction(
  conversation: Conversation,
  action: ReplyAction,
  opts?: { inboundAt?: Date },
): Promise<FlowResult> {
  const conversationId = conversation.id;

  switch (action.kind) {
    case "categories":
      await sendSectionList(conversationId, conversation.storeId, undefined, action.page ?? 0);
      return { sent: true };

    case "category": {
      const found = await getCategoryItems(conversation.storeId, action.categoryId);
      if (!found) {
        await sendMenu(conversationId, conversation.storeId, "That part of the menu has changed. Here is the full menu:");
        return { sent: true };
      }
      const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { store: true } });
      const draft = await findDraft(conversationId);
      const open = Boolean(draft && draft.items.length > 0 && !nextRequirement(draft));
      await sendToCustomer(
        conversationId,
        categoryItemsMessage(conv.store, found.category, found.items, action.page ?? 0, {
          adding: open,
          buttonLabel: open ? "Add this item" : undefined,
          body: open && draft ? interactiveBasket(draft, conv.store) : undefined,
        }),
        "AI",
      );
      // Leave the item list as the last message. Collect stays on the section
      // list, so opening chicken does not check the order out.
      await setPendingQuestion(conversationId, open ? "ANYTHING_ELSE" : "NONE");
      return { sent: true };
    }

    case "typeOrder":
      await sendToCustomer(conversationId, TYPE_ORDER_MESSAGE, "AI");
      await setPendingQuestion(conversationId, "NONE");
      return { sent: true };

    case "onlineMenu": {
      const orderUrl = `${env.appUrl.replace(/\/$/, "")}/order`;
      await sendToCustomer(conversationId, onlineMenuMessage(orderUrl), "AI");
      await setPendingQuestion(conversationId, "NONE");
      return { sent: true };
    }

    case "menuPhotos": {
      const sent = await sendMenuPictures(conversationId, { force: true });
      if (!sent) {
        await sendToCustomer(conversationId, { kind: "text", text: "I cannot load the menu pictures right now, but you can still tap through the menu." }, "AI");
      }
      await sendSectionList(conversationId, conversation.storeId, "Tap a section if you would rather order from the list:");
      return { sent: true };
    }

    case "item": {
      const draft = await getOrCreateDraft(conversationId);
      await addItem(draft.id, { menuItemId: action.menuItemId });
      // A new item reopens the menu after its questions, even if they had already said they were finished.
      await db.conversation.update({ where: { id: conversationId }, data: { askedAnythingElse: false } });
      return advanceFlow(conversationId);
    }

    case "modifier": {
      const option = await db.modifierOption.findUnique({ where: { id: action.optionId } });
      const draft = await findDraft(conversationId);
      if (!option || !draft) return staleTap(conversationId);
      await setModifierSelection(draft.id, action.orderItemId, option.groupId, [option.id]);
      // A burst of taps on the same list used to send a question per tap, and
      // the last tap was the one on the receipt. Save each tap, and let the
      // latest one speak so the message names the flavour that was kept.
      if (opts?.inboundAt && (await hasNewerInbound(conversationId, opts.inboundAt))) {
        await rememberNotesIfThatIsNext(conversationId);
        return { sent: true };
      }
      return advanceFlow(conversationId);
    }

    case "modifierSkip": {
      const draft = await findDraft(conversationId);
      if (!draft) return staleTap(conversationId);
      await setModifierSelection(draft.id, action.orderItemId, action.groupId, []);
      return advanceFlow(conversationId);
    }

    case "meal": {
      const draft = await findDraft(conversationId);
      if (!draft) return staleTap(conversationId);
      await setMealUpgrade(draft.id, action.orderItemId, action.yes);
      return advanceFlow(conversationId);
    }

    case "itemNote": {
      const draft = await findDraft(conversationId);
      if (!draft) return staleTap(conversationId);
      await setItemNotes(draft.id, action.orderItemId, null);
      return advanceFlow(conversationId);
    }

    case "fulfilment": {
      const draft = await findDraft(conversationId);
      if (!draft) return staleTap(conversationId);
      await db.conversation.update({ where: { id: conversationId }, data: { askedAnythingElse: true } });
      await setFulfilment(draft.id, action.mode);
      return advanceFlow(conversationId);
    }

    case "deliveryNote": {
      const draft = await findDraft(conversationId);
      if (!draft) return staleTap(conversationId);
      await setDeliveryNotes(draft.id, null);
      return advanceFlow(conversationId);
    }

    case "basket": {
      const draft = await findDraft(conversationId);
      if (!draft?.items.length) {
        await sendMenu(conversationId, conversation.storeId, "What can we get you?");
        return { sent: true };
      }
      if (nextRequirement(draft)) return advanceFlow(conversationId);
      await sendKeepAdding(conversationId, draft);
      return { sent: true };
    }

    case "anythingElse": {
      if (!action.done) {
        const draft = await findDraft(conversationId);
        if (draft?.items.length) {
          await sendAddingSections(conversationId, draft, 0);
          return { sent: true };
        }
        await sendMenu(conversationId, conversation.storeId, "What else can I get you?");
        return { sent: true };
      }
      const draft = await findDraft(conversationId);
      if (!draft || !draft.items.length) return staleTap(conversationId);
      // Mark the question answered so advanceFlow moves on to confirmation.
      await db.conversation.update({ where: { id: conversationId }, data: { askedAnythingElse: true } });
      return advanceFlow(conversationId);
    }

    case "confirm":
      return applyConfirmation(conversation, action.answer);

    case "cancelOrder": {
      const active = await findActiveOrder(conversationId);
      if (!active) return staleTap(conversationId);
      if (!action.yes) {
        await sendToCustomer(conversationId, KEEP_ORDER_MESSAGE, "AI");
        await setPendingQuestion(conversationId, "NONE");
        return { sent: true };
      }
      await cancelOrder(active.id, { by: "CUSTOMER", reason: "Cancelled on WhatsApp by the customer", actor: "customer" });
      await resetConversation(conversationId);
      return { sent: true };
    }

    case "human":
      await handOverToHuman(conversationId, "Customer asked for a staff member");
      await sendToCustomer(conversationId, HANDOVER_MESSAGE, "AI");
      return { sent: true };
  }
}

async function staleTap(conversationId: string): Promise<FlowResult> {
  await sendToCustomer(conversationId, STALE_TAP_MESSAGE, "AI");
  const advanced = await advanceFlow(conversationId);
  return { sent: advanced.sent || true };
}

export async function applyConfirmation(conversation: Conversation, answer: "yes" | "change" | "cancel"): Promise<FlowResult> {
  const conversationId = conversation.id;
  const draft = await findDraft(conversationId);
  if (!draft || !draft.items.length) return staleTap(conversationId);

  if (answer === "yes") {
    try {
      await confirmOrder(draft.id);
      await resetConversation(conversationId);
      return { sent: true };
    } catch (e) {
      // Something in the basket became unanswerable (an item went sold out, or
      // a choice was cleared); ask for what is missing instead of failing.
      console.warn("[flow] confirmation blocked", errorMessage(e));
      await backToDraft(draft.id);
      return advanceFlow(conversationId);
    }
  }

  if (answer === "change") {
    const order = await backToDraft(draft.id);
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { store: true } });
    await sendToCustomer(conversationId, changeRequestMessage(order, conv.store), "AI");
    await setPendingQuestion(conversationId, "NONE");
    return { sent: true };
  }

  await cancelOrder(draft.id, { by: "CUSTOMER", reason: "Customer cancelled before the order went to the kitchen", actor: "customer", notify: false });
  await sendToCustomer(conversationId, DRAFT_CANCELLED_MESSAGE, "AI");
  await resetConversation(conversationId);
  return { sent: true };
}

// ---------------------------------------------------------------- Typed replies

/**
 * Try to answer the outstanding question from free text before spending an AI
 * call: "ja", "hot", "no thanks that's all". Returns false when the text is not
 * a plain answer to the question asked, which hands it to the agent.
 */
export async function handlePendingText(conversation: Conversation, text: string): Promise<FlowResult | null> {
  const context = (conversation.pendingContext ?? {}) as { orderItemId?: string; modifierGroupId?: string };

  switch (conversation.pendingQuestion) {
    case "ORDER_CONFIRMATION": {
      if (wantsCancel(text)) return applyConfirmation(conversation, "cancel");
      const answer = readConfirmation(text);
      if (answer === "unclear") return null;
      return applyConfirmation(conversation, answer === "yes" ? "yes" : "cancel");
    }

    case "ANYTHING_ELSE": {
      if (wantsCancel(text) || /^\s*declined?[.!]?\s*$/i.test(text)) return applyConfirmation(conversation, "cancel");
      const answer = readAnythingElse(text);
      if (answer === "unclear") return null;
      return applyReplyAction(conversation, { kind: "anythingElse", done: answer === "done" });
    }

    case "MEAL_UPGRADE": {
      const answer = readConfirmation(text);
      if (answer === "unclear" || !context.orderItemId) return null;
      return applyReplyAction(conversation, { kind: "meal", orderItemId: context.orderItemId, yes: answer === "yes" });
    }

    case "MODIFIER": {
      if (!context.orderItemId || !context.modifierGroupId) return null;
      const group = await db.modifierGroup.findUnique({
        where: { id: context.modifierGroupId },
        include: { options: { where: { available: true } } },
      });
      if (!group) return null;
      const ranked = rankByName(text, group.options, (o) => o.name);
      if (!isDecisive(ranked)) return null;
      return applyReplyAction(conversation, { kind: "modifier", orderItemId: context.orderItemId, optionId: ranked[0].value.id });
    }

    case "CANCEL_CONFIRMATION": {
      const answer = readConfirmation(text);
      if (answer === "unclear") return null;
      return applyReplyAction(conversation, { kind: "cancelOrder", yes: answer === "yes" });
    }

    case "ITEM_NOTES": {
      const draft = await findDraft(conversation.id);
      if (!draft || !context.orderItemId) return null;
      await setItemNotes(draft.id, context.orderItemId, isSkippedItemNote(text) ? null : text);
      return advanceFlow(conversation.id);
    }

    case "FULFILMENT": {
      if (!DELIVERY_ENABLED) {
        const draft = await findDraft(conversation.id);
        if (!draft) return null;
        await setFulfilment(draft.id, "COLLECTION");
        await sendToCustomer(conversation.id, COLLECTION_ONLY_MESSAGE, "AI");
        return advanceFlow(conversation.id);
      }
      const mode = readFulfilment(text);
      if (mode !== "unclear") return applyReplyAction(conversation, { kind: "fulfilment", mode });
      const answer = readConfirmation(text);
      if (answer === "yes") return applyReplyAction(conversation, { kind: "fulfilment", mode: "DELIVERY" });
      if (answer === "no") return applyReplyAction(conversation, { kind: "fulfilment", mode: "COLLECTION" });
      return null;
    }

    case "DELIVERY_ADDRESS": {
      const draft = await findDraft(conversation.id);
      if (!draft) return null;
      if (!DELIVERY_ENABLED) {
        await setFulfilment(draft.id, "COLLECTION");
        await sendToCustomer(conversation.id, COLLECTION_ONLY_MESSAGE, "AI");
        return advanceFlow(conversation.id);
      }
      const wantNote = Boolean((context as { wantNote?: boolean }).wantNote);
      if (wantNote) {
        await setDeliveryNotes(draft.id, isSkippedDriverNote(text) ? null : text.trim());
        return advanceFlow(conversation.id);
      }
      const mode = readFulfilment(text);
      if (mode === "COLLECTION") return applyReplyAction(conversation, { kind: "fulfilment", mode: "COLLECTION" });
      const parsed = parseDeliveryText(text);
      if (!parsed) return null;
      await setFulfilment(draft.id, "DELIVERY", parsed.address, {
        notes: parsed.notes,
        latitude: null,
        longitude: null,
      });
      if (parsed.notes) return advanceFlow(conversation.id);
      await sendToCustomer(conversation.id, deliveryNoteMessage(), "AI");
      await setPendingQuestion(conversation.id, "DELIVERY_ADDRESS", { orderId: draft.id, wantNote: true });
      return { sent: true };
    }

    default:
      return null;
  }
}

/** A WhatsApp location pin stands in for the street address. A driver note is asked next. */
export async function acceptDeliveryPin(
  conversationId: string,
  loc: { latitude: number; longitude: number; name?: string; address?: string },
): Promise<FlowResult> {
  if (!DELIVERY_ENABLED) return { sent: false };
  const draft = await findDraft(conversationId);
  if (!draft?.items.length) return { sent: false };
  await db.conversation.update({ where: { id: conversationId }, data: { askedAnythingElse: true } });
  await setFulfilment(draft.id, "DELIVERY", pinLabel(loc), {
    notes: null,
    latitude: loc.latitude,
    longitude: loc.longitude,
  });
  await sendToCustomer(conversationId, deliveryNoteMessage(), "AI");
  await setPendingQuestion(conversationId, "DELIVERY_ADDRESS", { orderId: draft.id, wantNote: true });
  return { sent: true };
}

/** Ask the customer to confirm a cancellation of an order already in the kitchen. */
export async function askToConfirmCancel(conversationId: string, orderId: string): Promise<FlowResult> {
  const order = await findActiveOrder(conversationId);
  if (!order) return { sent: false };
  await sendToCustomer(conversationId, cancelConfirmMessage(order), "AI");
  await setPendingQuestion(conversationId, "CANCEL_CONFIRMATION", { orderId });
  return { sent: true };
}
