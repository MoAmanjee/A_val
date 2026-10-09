import { Prisma, type Conversation } from "@prisma/client";
import { db } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { handOverToHuman, sendToCustomer, setPendingQuestion } from "@/services/conversations";
import { readAnythingElse, readConfirmation, readFulfilment } from "@/services/conversations/understanding";
import { getCategories, getCategoryItems, isDecisive, rankByName } from "@/services/menu";
import { sendMenuPictures } from "@/services/menu/images";
import type { ReplyAction } from "@/services/messaging/reply-ids";
import {
  categoryItemsMessage,
  categoryPickerMessage,
  cancelConfirmMessage,
  changeRequestMessage,
  confirmationMessages,
  deliveryAddressMessage,
  DRAFT_CANCELLED_MESSAGE,
  fulfilmentMessage,
  HANDOVER_MESSAGE,
  KEEP_ORDER_MESSAGE,
  keepAddingBody,
  mealUpgradeMessage,
  modifierQuestionMessage,
  STALE_TAP_MESSAGE,
  TYPE_ORDER_MESSAGE,
} from "@/services/messaging/templates";
import { addItem, findDraft, getOrCreateDraft, setFulfilment, setMealUpgrade, setModifierSelection } from "@/services/orders/cart";
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
 * After an item is complete, show every section. Collect and Delivery sit at
 * the bottom of that list, so the next tap can add a burger, then chicken,
 * then a drink, instead of checking out.
 */
async function sendKeepAdding(conversationId: string, order: NonNullable<Awaited<ReturnType<typeof findDraft>>>) {
  await sendAddingSections(conversationId, order, 0);
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
    categoryPickerMessage(conv.store, categories, keepAddingBody(order, conv.store), { checkout: true, page }),
    "AI",
  );
  await setPendingQuestion(conversationId, "ANYTHING_ELSE");
}

// ---------------------------------------------------------------- Tapped replies

/**
 * Apply a button or list reply. These never go near the language model: the id
 * carries the item and the choice, so the only thing that can go wrong is the
 * customer tapping something that has since been removed, which is reported
 * back plainly.
 */
export async function applyReplyAction(conversation: Conversation, action: ReplyAction): Promise<FlowResult> {
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
          body: open && draft ? keepAddingBody(draft, conv.store) : undefined,
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

    case "fulfilment": {
      const draft = await findDraft(conversationId);
      if (!draft) return staleTap(conversationId);
      await db.conversation.update({ where: { id: conversationId }, data: { askedAnythingElse: true } });
      await setFulfilment(draft.id, action.mode);
      return advanceFlow(conversationId);
    }

    case "anythingElse": {
      if (!action.done) {
        const draft = await findDraft(conversationId);
        if (draft?.items.length) {
          await sendKeepAdding(conversationId, draft);
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
      const answer = readConfirmation(text);
      if (answer === "unclear") return null;
      return applyConfirmation(conversation, answer === "yes" ? "yes" : "change");
    }

    case "ANYTHING_ELSE": {
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

    case "FULFILMENT": {
      const mode = readFulfilment(text);
      if (mode === "unclear") return null;
      return applyReplyAction(conversation, { kind: "fulfilment", mode });
    }

    case "DELIVERY_ADDRESS": {
      const mode = readFulfilment(text);
      if (mode === "COLLECTION") return applyReplyAction(conversation, { kind: "fulfilment", mode: "COLLECTION" });
      const address = text.trim();
      if (address.length < 5 || address.length > 240) return null;
      if (/^(do|does|can|could|what|where|when|how|is|are)\b/i.test(address)) return null;
      const draft = await findDraft(conversation.id);
      if (!draft) return null;
      await setFulfilment(draft.id, "DELIVERY", address);
      return advanceFlow(conversation.id);
    }

    default:
      return null;
  }
}

/** Ask the customer to confirm a cancellation of an order already in the kitchen. */
export async function askToConfirmCancel(conversationId: string, orderId: string): Promise<FlowResult> {
  const order = await findActiveOrder(conversationId);
  if (!order) return { sent: false };
  await sendToCustomer(conversationId, cancelConfirmMessage(order), "AI");
  await setPendingQuestion(conversationId, "CANCEL_CONFIRMATION", { orderId });
  return { sent: true };
}
