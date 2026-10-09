import type { MenuCategory, MenuItem, Store } from "@prisma/client";
import { encodeReplyId } from "@/services/messaging/reply-ids";
import type { FullOrder, FullOrderItem, ItemModifierLink } from "@/services/orders/query";
import { clamp, WA_LIMITS, type ListRow, type OutboundMessage } from "@/services/whatsapp";
import { formatCents } from "@/utils/money";
import { formatClock } from "@/utils/time";

/**
 * Every customer-facing message the bot sends. Keeping them here means prices,
 * totals and order summaries are rendered from the database in one place rather
 * than written by the language model, which must never invent a price.
 */

const MAX_SUMMARY_IN_BODY = 900;
const TYPE_THE_REST = "Or type the rest in one message";

export function storeName(store: Store): string {
  return store.tradingName || store.name;
}

function money(store: Store, cents: number): string {
  return formatCents(cents, store.currencySymbol);
}

/** "Hot · Meal with Chips and Coke · Extra cheese" */
export function describeItemChoices(item: FullOrderItem): string {
  const byGroup = new Map<string, string[]>();
  for (const m of item.modifiers) {
    const list = byGroup.get(m.groupNameSnapshot) ?? [];
    list.push(m.optionNameSnapshot);
    byGroup.set(m.groupNameSnapshot, list);
  }

  const parts: string[] = [];
  const mealGroups = new Set<string>();
  for (const link of item.menuItem.modifierLinks) {
    if (link.scope === "MEAL_ONLY") mealGroups.add(link.group.name);
  }

  for (const [group, options] of byGroup) {
    if (mealGroups.has(group)) continue;
    parts.push(options.join(" + "));
  }

  if (item.isMeal) {
    const mealExtras = [...byGroup.entries()].filter(([g]) => mealGroups.has(g)).flatMap(([, o]) => o);
    parts.push(mealExtras.length ? `Meal with ${joinWords(mealExtras)}` : "Meal");
  }
  return parts.filter(Boolean).join(" \u00b7 ");
}

function joinWords(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

export function orderLines(order: FullOrder, store: Store): string {
  return order.items
    .map((item) => {
      const head = `*${item.quantity} \u00d7 ${item.nameSnapshot}* \u2014 ${money(store, item.lineTotalCents)}`;
      const choices = describeItemChoices(item);
      const rows = [head];
      if (choices) rows.push(`   ${choices}`);
      if (item.notes) rows.push(`   Note: ${item.notes}`);
      return rows.join("\n");
    })
    .join("\n");
}

export function fulfilmentSummary(
  order: { fulfilment?: "COLLECTION" | "DELIVERY" | null; deliveryAddress?: string | null },
  store: Store,
): string | null {
  if (order.fulfilment === "DELIVERY") {
    return order.deliveryAddress?.trim() ? `Delivery to ${order.deliveryAddress.trim()}` : "Delivery";
  }
  if (order.fulfilment === "COLLECTION") {
    return `Collection from ${store.addressLine}${store.suburb ? `, ${store.suburb}` : ""}`;
  }
  return null;
}

export function orderSummaryText(order: FullOrder, store: Store): string {
  const lines = orderLines(order, store);
  const total = `*Total: ${money(store, order.totalCents)}*`;
  const going = fulfilmentSummary(order, store);
  const notes = order.notes ? `\nNote for the kitchen: ${order.notes}` : "";
  return `${lines}\n\n${total}${going ? `\n${going}` : ""}${notes}`;
}

// ---------------------------------------------------------------- Greeting & menu

export function welcomeMessage(
  store: Store,
  name: string | null,
  categories: Pick<MenuCategory, "id" | "name" | "description">[],
  opts: { returning?: boolean; openNote?: string } = {},
): OutboundMessage {
  const hello = name ? `Hi ${name}!` : "Hi there!";
  const intro = opts.returning
    ? `${hello} 👋 Welcome back to ${storeName(store)}.`
    : `${hello} 👋 Welcome to ${storeName(store)} in ${store.city}.`;
  const body = `${intro}\n\nWhat would you like to order today? Tap below to browse the menu, or type the whole order in one message \u2014 for example "hot quarter chicken meal with a Coke, delivery to 14 Kock Street".`;

  return {
    kind: "list",
    header: storeName(store),
    body,
    footer: opts.openNote,
    buttonLabel: "See the menu",
    sections: [{ title: "Menu", rows: categoryListRows(categories) }],
  };
}

function categoryRow(category: Pick<MenuCategory, "id" | "name" | "description">): ListRow {
  return {
    id: encodeReplyId({ kind: "category", categoryId: category.id }),
    title: clamp(category.name, WA_LIMITS.rowTitle),
    description: category.description ?? undefined,
  };
}

const MENU_PICTURES_ROW: ListRow = {
  id: encodeReplyId({ kind: "menuPhotos" }),
  title: "Menu pictures",
  description: "The printed menu, two pages",
};

/** Photo row plus categories, never more than Meta's 10-row cap. */
export function categoryListRows(categories: Pick<MenuCategory, "id" | "name" | "description">[]): ListRow[] {
  const rows = [MENU_PICTURES_ROW, ...categories.map(categoryRow)];
  if (rows.length <= WA_LIMITS.maxListRows) return rows;
  const kept = rows.slice(0, WA_LIMITS.maxListRows - 1);
  kept.push({
    id: encodeReplyId({ kind: "human" }),
    title: "More with staff",
    description: "Ask and we will talk you through the rest",
  });
  return kept;
}

export function categoryPickerMessage(
  store: Store,
  categories: Pick<MenuCategory, "id" | "name" | "description">[],
  body = "Here is our menu. What can we get you?",
): OutboundMessage {
  return {
    kind: "list",
    header: storeName(store),
    body,
    buttonLabel: "See the menu",
    sections: [{ title: "Menu", rows: categoryListRows(categories) }],
  };
}

type MenuItemRow = Pick<MenuItem, "id" | "name" | "shortName" | "description" | "priceCents" | "mealUpgradeCents" | "available" | "soldOutNote">;

/** Items per page once a More row and a Back row are reserved. */
const ITEM_PAGE = WA_LIMITS.maxListRows - 2;

export function categoryItemsMessage(
  store: Store,
  category: Pick<MenuCategory, "id" | "name" | "description">,
  items: MenuItemRow[],
  page = 0,
): OutboundMessage {
  const available = items.filter((i) => i.available);
  const soldOut = items.filter((i) => !i.available);
  const pages = Math.max(1, Math.ceil(available.length / ITEM_PAGE));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const slice = available.slice(safePage * ITEM_PAGE, safePage * ITEM_PAGE + ITEM_PAGE);
  const hasMore = (safePage + 1) * ITEM_PAGE < available.length;

  const rows: ListRow[] = slice.map((item) => ({
    id: encodeReplyId({ kind: "item", menuItemId: item.id }),
    title: clamp(item.shortName?.trim() || item.name, WA_LIMITS.rowTitle),
    description: itemPriceLine(store, item),
  }));
  if (hasMore) {
    rows.push({
      id: encodeReplyId({ kind: "category", categoryId: category.id, page: safePage + 1 }),
      title: "More items",
      description: `Page ${safePage + 2} of ${pages}`,
    });
  }
  rows.push({ id: encodeReplyId({ kind: "categories" }), title: "\u2190 Back to menu" });

  const header = category.description ? `${category.name} \u2014 ${category.description}` : category.name;
  const pageNote = pages > 1 ? ` (page ${safePage + 1} of ${pages})` : "";
  const soldOutNote = soldOut.length ? `\n\nSold out tonight: ${soldOut.map((i) => i.name).join(", ")}.` : "";

  return {
    kind: "list",
    body: `${header}${pageNote}${soldOutNote}`,
    buttonLabel: "Choose an item",
    sections: [{ title: clamp(category.name, WA_LIMITS.sectionTitle), rows }],
  };
}

export function itemPriceLine(store: Store, item: Pick<MenuItem, "priceCents" | "mealUpgradeCents" | "description">): string {
  const price = money(store, item.priceCents);
  const meal = item.mealUpgradeCents !== null ? ` \u00b7 meal +${money(store, item.mealUpgradeCents)}` : "";
  const desc = item.description ? ` \u00b7 ${item.description}` : "";
  return `${price}${meal}${desc}`;
}

/** Plain-text menu for customers who would rather read than tap. */
export function fullMenuText(store: Store, categories: (MenuCategory & { items: MenuItemRow[] })[]): string {
  const blocks = categories.map((c) => {
    const items = c.items
      .filter((i) => i.available)
      .map((i) => {
        const meal = i.mealUpgradeCents !== null ? ` (meal ${money(store, i.priceCents + i.mealUpgradeCents)})` : "";
        return `  ${i.name} \u2014 ${money(store, i.priceCents)}${meal}`;
      })
      .join("\n");
    return `*${c.name}*\n${items}`;
  });
  return `*${storeName(store)} menu*\n\n${blocks.join("\n\n")}\n\nJust tell me what you would like and I will put it together.`;
}

// ---------------------------------------------------------------- Slot questions

/** Prefix the item name when the basket holds more than one line. */
function forItem(order: FullOrder, item: FullOrderItem): string {
  return order.items.length > 1 ? `For your ${item.nameSnapshot}: ` : "";
}

export function modifierQuestionMessage(order: FullOrder, item: FullOrderItem, link: ItemModifierLink, store: Store): OutboundMessage {
  const group = link.group;
  const options = group.options.filter((o) => o.available);
  const body = `${forItem(order, item)}${group.prompt}`;

  const label = (name: string, delta: number) => (delta > 0 ? `${name} (+${money(store, delta)})` : name);

  if (group.selection === "SINGLE" && options.length <= WA_LIMITS.maxButtons && options.every((o) => o.name.length <= 16)) {
    return {
      kind: "buttons",
      body,
      footer: TYPE_THE_REST,
      buttons: options.map((o) => ({
        id: encodeReplyId({ kind: "modifier", orderItemId: item.id, optionId: o.id }),
        title: label(o.name, o.priceDeltaCents),
      })),
    };
  }

  const rows: ListRow[] = options.map((o) => ({
    id: encodeReplyId({ kind: "modifier", orderItemId: item.id, optionId: o.id }),
    title: label(o.name, o.priceDeltaCents),
    description: o.description ?? undefined,
  }));
  if (!link.required) {
    rows.push({ id: encodeReplyId({ kind: "modifierSkip", orderItemId: item.id, groupId: group.id }), title: "No thanks" });
  }

  return {
    kind: "list",
    body,
    footer: TYPE_THE_REST,
    buttonLabel: group.name.length <= WA_LIMITS.listButtonLabel ? `Choose ${group.name.toLowerCase()}`.slice(0, WA_LIMITS.listButtonLabel) : "Choose",
    sections: [{ title: group.name, rows: rows.slice(0, WA_LIMITS.maxListRows) }],
  };
}

export function mealUpgradeMessage(order: FullOrder, item: FullOrderItem, store: Store): OutboundMessage {
  const upgrade = item.menuItem.mealUpgradeCents ?? item.mealUpgradeCents;
  const includes = item.menuItem.mealDescription?.trim() || "a side and a drink";
  return {
    kind: "buttons",
    body: `${forItem(order, item)}Would you like that as a meal? A meal adds ${includes} for ${money(store, upgrade)}.`,
    footer: TYPE_THE_REST,
    buttons: [
      { id: encodeReplyId({ kind: "meal", orderItemId: item.id, yes: true }), title: "Yes, make it a meal" },
      { id: encodeReplyId({ kind: "meal", orderItemId: item.id, yes: false }), title: "No, on its own" },
    ],
  };
}

export function fulfilmentMessage(store: Store): OutboundMessage {
  return {
    kind: "buttons",
    body: `Would you like to collect from ${store.addressLine}, or should we deliver in ${store.city}? For delivery, send the street address in the same message.`,
    footer: "Pay the driver, or at the till",
    buttons: [
      { id: encodeReplyId({ kind: "fulfilment", mode: "COLLECTION" }), title: "Collect" },
      { id: encodeReplyId({ kind: "fulfilment", mode: "DELIVERY" }), title: "Delivery" },
    ],
  };
}

export function deliveryAddressMessage(store: Store): OutboundMessage {
  return {
    kind: "text",
    text: `Where in ${store.city} should we deliver it? Send the street address, for example 14 Kock Street.`,
  };
}

export function anythingElseMessage(order: FullOrder, store: Store): OutboundMessage {
  return {
    kind: "buttons",
    body: `So far I have:\n\n${orderLines(order, store)}\n\n*Total: ${money(store, order.totalCents)}*\n\nAnything else? I can add another item, a side, a drink or extras like cheese or avo.`,
    buttons: [
      { id: encodeReplyId({ kind: "anythingElse", done: false }), title: "Add something" },
      { id: encodeReplyId({ kind: "anythingElse", done: true }), title: "That's everything" },
    ],
  };
}

/**
 * The confirmation step. The summary goes in the button message when it fits,
 * otherwise it is sent as its own message first so nothing is truncated away.
 */
function confirmationQuestion(order: FullOrder, store: Store, prepMinutes: number): string {
  if (order.fulfilment === "DELIVERY" && order.deliveryAddress?.trim()) {
    return `Is that correct? Tap *Yes, order it* and I will send it to the kitchen \u2014 about ${prepMinutes} minutes, delivered to ${order.deliveryAddress.trim()}. Pay the driver when it arrives.`;
  }
  return `Is that correct? Tap *Yes, order it* and I will send it straight to the kitchen \u2014 about ${prepMinutes} minutes for collection from ${store.addressLine}. Pay at the till.`;
}

export function confirmationMessages(order: FullOrder, store: Store, prepMinutes: number): OutboundMessage[] {
  const summary = orderSummaryText(order, store);
  const question = confirmationQuestion(order, store, prepMinutes);
  const buttons = [
    { id: encodeReplyId({ kind: "confirm", answer: "yes" as const }), title: "Yes, order it" },
    { id: encodeReplyId({ kind: "confirm", answer: "change" as const }), title: "Change something" },
    { id: encodeReplyId({ kind: "confirm", answer: "cancel" as const }), title: "Cancel order" },
  ];

  const inline = `🧾 *Your order*\n\n${summary}\n\n${question}`;
  if (inline.length <= MAX_SUMMARY_IN_BODY) {
    return [{ kind: "buttons", body: inline, buttons }];
  }
  return [
    { kind: "text", text: `🧾 *Your order*\n\n${summary}` },
    { kind: "buttons", body: question, buttons },
  ];
}

// ---------------------------------------------------------------- Order progress

export function orderPlacedMessage(order: FullOrder, store: Store, prepMinutes: number): OutboundMessage {
  const delivering = order.fulfilment === "DELIVERY" && Boolean(order.deliveryAddress?.trim());
  return {
    kind: "text",
    text: delivering
      ? [
          `✅ Thank you! Order *${order.orderNumber}* is confirmed and on its way to the kitchen.`,
          `Total: *${money(store, order.totalCents)}* \u2014 pay the driver when it arrives.`,
          ``,
          `We will deliver to ${order.deliveryAddress?.trim()}.`,
          `I will message you when the kitchen starts on it, and again when it is on the way. It usually takes about ${prepMinutes} minutes.`,
        ].join("\n")
      : [
          `✅ Thank you! Order *${order.orderNumber}* is confirmed and on its way to the kitchen.`,
          `Total: *${money(store, order.totalCents)}* \u2014 pay when you collect.`,
          ``,
          `We are at ${store.addressLine}${store.suburb ? `, ${store.suburb}` : ""}, ${store.city}.`,
          `I will message you the moment the kitchen starts on it, and again when it is ready. It usually takes about ${prepMinutes} minutes.`,
        ].join("\n"),
  };
}

export function kitchenAcknowledgedMessage(order: FullOrder, store: Store): OutboundMessage {
  const at = order.promisedReadyAt ? formatClock(order.promisedReadyAt, store.timezone) : null;
  const delivering = order.fulfilment === "DELIVERY";
  const readyFor = delivering ? "out for delivery" : "ready for collection";
  return {
    kind: "text",
    text: at
      ? `👨‍🍳 The kitchen has started on order *${order.orderNumber}*. It should be ${readyFor} at about *${at}*.`
      : `👨‍🍳 The kitchen has your order *${order.orderNumber}* and is starting on it now.`,
  };
}

export function orderReadyMessage(order: FullOrder, store: Store): OutboundMessage {
  const delivering = order.fulfilment === "DELIVERY" && Boolean(order.deliveryAddress?.trim());
  return {
    kind: "text",
    text: delivering
      ? [
          `🔔 Order *${order.orderNumber}* is on its way to ${order.deliveryAddress?.trim()}!`,
          `Amount due: *${money(store, order.totalCents)}*. Pay the driver when it arrives. Enjoy! 🔥`,
        ].join("\n")
      : [
          `🔔 Order *${order.orderNumber}* is ready for collection!`,
          `Come through to ${store.addressLine}${store.suburb ? `, ${store.suburb}` : ""} and give your order number at the till.`,
          `Amount due: *${money(store, order.totalCents)}*. Enjoy! 🔥`,
        ].join("\n"),
  };
}

export function orderCollectedMessage(order: FullOrder, store: Store): OutboundMessage {
  const delivering = order.fulfilment === "DELIVERY";
  return {
    kind: "text",
    text: delivering
      ? `Thanks! 🙌 Order *${order.orderNumber}* has been delivered. Message us any time to order again from ${storeName(store)}.`
      : `Thanks for coming through! 🙌 Order *${order.orderNumber}* is all settled. Message us any time to order again from ${storeName(store)}.`,
  };
}

export function orderCancelledMessage(order: FullOrder, reason: string | null, byKitchen: boolean): OutboundMessage {
  const base = `Order *${order.orderNumber}* has been cancelled.`;
  if (byKitchen) {
    return {
      kind: "text",
      text: `😞 Sorry, we had to cancel order *${order.orderNumber}*.${reason ? ` ${reason}` : ""} Nothing will be charged. Message me if you would like to order something else.`,
    };
  }
  return { kind: "text", text: `${base} Nothing will be charged. Message me whenever you would like to order again! 👋` };
}

export function cancelConfirmMessage(order: FullOrder): OutboundMessage {
  return {
    kind: "buttons",
    body: `Just checking \u2014 would you like me to cancel order *${order.orderNumber}*?`,
    buttons: [
      { id: encodeReplyId({ kind: "cancelOrder", yes: true }), title: "Yes, cancel it" },
      { id: encodeReplyId({ kind: "cancelOrder", yes: false }), title: "No, keep it" },
    ],
  };
}

export function closedMessage(store: Store, openNote: string, opts: { withMenu?: boolean } = {}): OutboundMessage {
  const menu = opts.withMenu ? " The menu is just below so you can see what we have." : "";
  return {
    kind: "text",
    text: `Thanks for messaging ${storeName(store)}! We are closed right now \u2014 ${openNote}${menu} Send me your order when we are open and I will get it in. 👋`,
  };
}

export function pausedMessage(store: Store): OutboundMessage {
  return {
    kind: "text",
    text: `Thanks for messaging ${storeName(store)}! We have paused new WhatsApp orders for a moment${store.pausedReason ? ` \u2014 ${store.pausedReason}` : ""}. Please try again shortly or give us a call${store.phone ? ` on +${store.phone}` : ""}.`,
  };
}

export function changeRequestMessage(order: FullOrder, store: Store): OutboundMessage {
  return {
    kind: "text",
    text: `No problem. Right now I have:\n\n${orderLines(order, store)}\n\nWhat would you like to change? You can say things like "make the burger mild", "remove the chips" or "add a Coke".`,
  };
}

export const ADD_MORE_MESSAGE: OutboundMessage = {
  kind: "text",
  text: "Sure \u2014 what else can I add? Tell me the item, or tap *See the menu* above to browse.",
};

export const DRAFT_CANCELLED_MESSAGE: OutboundMessage = {
  kind: "text",
  text: "No problem, I have cleared that. Message me whenever you would like to order. 👋",
};

export const KEEP_ORDER_MESSAGE: OutboundMessage = {
  kind: "text",
  text: "Great, your order stays as it is. I will let you know as soon as it is ready. 👍",
};

/** The customer tapped a button that no longer applies to anything. */
export const STALE_TAP_MESSAGE: OutboundMessage = {
  kind: "text",
  text: "That option has moved on since I sent it \u2014 let me check where we are.",
};

export const HANDOVER_MESSAGE: OutboundMessage = {
  kind: "text",
  text: "No problem \u2014 I have passed this to one of the team and they will reply here shortly. 🙏",
};

export const FALLBACK_MESSAGE: OutboundMessage = {
  kind: "text",
  text: "Sorry, I am having a bit of trouble on my side. One of the team will pick this up with you here shortly.",
};

export const MEDIA_MESSAGE: OutboundMessage = {
  kind: "text",
  text: "Thanks! I can only read text at the moment \u2014 could you type what you would like to order and I will sort it out?",
};
