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
      if (item.notes) rows.push(`   Leave out: ${item.notes}`);
      return rows.join("\n");
    })
    .join("\n");
}

export function fulfilmentSummary(
  order: {
    fulfilment?: "COLLECTION" | "DELIVERY" | null;
    deliveryAddress?: string | null;
    deliveryNotes?: string | null;
  },
  store: Store,
): string | null {
  if (order.fulfilment === "DELIVERY") {
    const where = order.deliveryAddress?.trim() ? `Delivery to ${order.deliveryAddress.trim()}` : "Delivery";
    return order.deliveryNotes?.trim() ? `${where}\nDriver note: ${order.deliveryNotes.trim()}` : where;
  }
  if (order.fulfilment === "COLLECTION") {
    return `Collection from ${store.addressLine}${store.suburb ? `, ${store.suburb}` : ""}`;
  }
  return null;
}

export function deliveryFeeLine(cents: number, store: Store): string {
  return cents > 0 ? `Delivery ${money(store, cents)}` : "Delivery free";
}

export function orderSummaryText(order: FullOrder, store: Store): string {
  const lines = orderLines(order, store);
  const fee = order.fulfilment === "DELIVERY" ? deliveryFeeLine(order.deliveryFeeCents, store) : null;
  const total = `*Total: ${money(store, order.totalCents)}*`;
  const going = fulfilmentSummary(order, store);
  const notes = order.notes ? `\nNote for the kitchen: ${order.notes}` : "";
  return `${lines}${fee ? `\n${fee}` : ""}\n\n${total}${going ? `\n${going}` : ""}${notes}`;
}

// ---------------------------------------------------------------- Greeting & menu

export function welcomeMessage(
  store: Store,
  name: string | null,
  opts: { returning?: boolean; openNote?: string; orderUrl: string },
): OutboundMessage {
  const hello = name ? `Hi ${name}!` : "Hi there!";
  const intro = opts.returning
    ? `${hello} 👋 Welcome back to ${storeName(store)}.`
    : `${hello} 👋 Welcome to ${storeName(store)} in ${store.city}.`;
  const body = [
    intro,
    "",
    "Tap Order online for the photo menu — spice, meals, and kitchen notes are there.",
    "Or type your order here, or say menu to browse in WhatsApp.",
  ].join("\n");

  // CTA URL opens the mini-site in WhatsApp's browser — no second "here is the link" message.
  return {
    kind: "cta_url",
    body,
    buttonText: "Order online",
    url: opts.orderUrl,
    footer: opts.openNote,
  };
}

/** Fallback if an old Order online reply button is tapped — still opens as a CTA, not a plain link text. */
export function onlineMenuMessage(orderUrl: string): OutboundMessage {
  return {
    kind: "cta_url",
    body: "Photo menu with Zee Flavours, meals, and kitchen notes — same kitchen as WhatsApp.",
    buttonText: "Order online",
    url: orderUrl,
  };
}

export const TYPE_ORDER_MESSAGE: OutboundMessage = {
  kind: "text",
  text: [
    "Type the whole order in one message.",
    "",
    "Put the spice with each item when they differ:",
    "quarter chicken hot meal with a coke, and a chicken burger mild",
    "",
    "If you leave a spice out, I will show a list for that item only. Type all hot if every item still waiting should be the same.",
  ].join("\n"),
};

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

const FINISH_ROWS: ListRow[] = [
  {
    id: encodeReplyId({ kind: "basket" }),
    title: "Back to my order",
    description: "Confirm or cancel",
  },
];

/**
 * Sections first, then Collect and Delivery at the bottom of the same list.
 * A separate button message under the items was getting tapped instead of the next item.
 */
export function addingSectionRows(
  categories: Pick<MenuCategory, "id" | "name" | "description">[],
  page = 0,
): ListRow[] {
  const finish = FINISH_ROWS.length;
  const overflow = categories.length > WA_LIMITS.maxListRows - finish;
  const pageSize = overflow ? WA_LIMITS.maxListRows - finish - 1 : WA_LIMITS.maxListRows - finish;
  const pages = Math.max(1, Math.ceil(categories.length / pageSize));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const slice = categories.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const rows = slice.map(categoryRow);
  if (safePage + 1 < pages) {
    rows.push({
      id: encodeReplyId({ kind: "categories", page: safePage + 1 }),
      title: "More sections",
      description: `Page ${safePage + 2} of ${pages}`,
    });
  }
  rows.push(...FINISH_ROWS);
  return rows;
}

/** @deprecated Use addingSectionRows. Kept so older callers still compile. */
export function checkoutCategoryRows(categories: Pick<MenuCategory, "id" | "name" | "description">[]): ListRow[] {
  return addingSectionRows(categories, 0);
}

const DONE_ORDERING_ROW: ListRow = {
  id: encodeReplyId({ kind: "anythingElse", done: true }),
  title: "That's everything",
  description: "No more items",
};

export function categoryPickerMessage(
  store: Store,
  categories: Pick<MenuCategory, "id" | "name" | "description">[],
  body = "Here is our menu. What can we get you?",
  opts: { checkout?: boolean; page?: number } = {},
): OutboundMessage {
  return {
    kind: "list",
    header: storeName(store),
    body: clamp(body, WA_LIMITS.interactiveBody),
    footer: opts.checkout ? "Pick a section. Your order is at the bottom." : undefined,
    buttonLabel: opts.checkout ? "Add to order" : "See the menu",
    sections: [{ title: "Menu", rows: opts.checkout ? addingSectionRows(categories, opts.page ?? 0) : categoryListRows(categories) }],
  };
}

type MenuItemRow = Pick<MenuItem, "id" | "name" | "shortName" | "description" | "priceCents" | "mealUpgradeCents" | "available" | "soldOutNote">;

/** Items per page once a More row and a Back row are reserved. */
const ITEM_PAGE = WA_LIMITS.maxListRows - 2;
/** Checkout also keeps a "That's everything" row, so one fewer item fits. */
const CHECKOUT_ITEM_PAGE = WA_LIMITS.maxListRows - 3;

export function categoryItemsMessage(
  store: Store,
  category: Pick<MenuCategory, "id" | "name" | "description">,
  items: MenuItemRow[],
  page = 0,
  opts: { checkout?: boolean; adding?: boolean; body?: string; buttonLabel?: string } = {},
): OutboundMessage {
  const available = items.filter((i) => i.available);
  const soldOut = items.filter((i) => !i.available);
  const pageSize = opts.checkout ? CHECKOUT_ITEM_PAGE : ITEM_PAGE;
  const pages = Math.max(1, Math.ceil(available.length / pageSize));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const slice = available.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const hasMore = (safePage + 1) * pageSize < available.length;

  const rows: ListRow[] = [];
  if (opts.checkout) rows.push(DONE_ORDERING_ROW);
  rows.push(
    ...slice.map((item) => ({
      id: encodeReplyId({ kind: "item", menuItemId: item.id }),
      title: clamp(item.shortName?.trim() || item.name, WA_LIMITS.rowTitle),
      description: itemPriceLine(store, item),
    })),
  );
  if (hasMore) {
    rows.push({
      id: encodeReplyId({ kind: "category", categoryId: category.id, page: safePage + 1 }),
      title: "More items",
      description: `Page ${safePage + 2} of ${pages}`,
    });
  }
  rows.push({
    id: encodeReplyId({ kind: "categories" }),
    title: opts.checkout || opts.adding ? "Other sections" : "\u2190 Back to menu",
    description: opts.checkout || opts.adding ? "Burgers, chicken, drinks" : undefined,
  });

  const header = category.description ? `${category.name} \u2014 ${category.description}` : category.name;
  const pageNote = pages > 1 ? ` (page ${safePage + 1} of ${pages})` : "";
  const soldOutNote = soldOut.length ? `\n\nSold out tonight: ${soldOut.map((i) => i.name).join(", ")}.` : "";
  const body = opts.body?.trim() || `${header}${pageNote}${soldOutNote}`;

  return {
    kind: "list",
    body: clamp(body, WA_LIMITS.interactiveBody),
    footer: opts.checkout ? TYPE_THE_REST : undefined,
    buttonLabel: opts.buttonLabel ?? (opts.checkout ? "Next item" : "Choose an item"),
    sections: [{ title: clamp(category.name, WA_LIMITS.sectionTitle), rows }],
  };
}

/** Running basket. The next step is buttons, not a paragraph. */
export function keepAddingBody(order: FullOrder, store: Store): string {
  const total = `*Total: ${money(store, order.totalCents)}*`;
  const lines = order.items.map((item) => {
    const choices = describeItemChoices(item);
    const qty = item.quantity > 1 ? `${item.quantity} × ` : "";
    return `• ${qty}${item.nameSnapshot}${choices ? ` (${choices})` : ""}`;
  });
  let shown = lines;
  while (shown.length > 1) {
    const extra = lines.length - shown.length;
    const lead = extra > 0 ? `So far, plus ${extra} earlier:\n` : "So far:\n";
    const body = `${lead}${shown.join("\n")}\n\n${total}`;
    if (body.length <= MAX_SUMMARY_IN_BODY) return body;
    shown = shown.slice(1);
  }
  const extra = lines.length - shown.length;
  const lead = extra > 0 ? `So far, plus ${extra} earlier:\n` : "So far:\n";
  return clamp(`${lead}${shown.join("\n")}\n\n${total}`, MAX_SUMMARY_IN_BODY);
}

/** Short enough to sit in a list or a button. A long basket is sent as its own text. */
export function interactiveBasket(order: FullOrder, store: Store): string {
  const full = keepAddingBody(order, store);
  if (full.length <= 700 && !full.includes("earlier") && !full.endsWith("\u2026")) return full;
  return `${order.items.length} items so far.\n*Total: ${money(store, order.totalCents)}*`;
}

const CONFIRM_PROMPT = "Confirm this order, add another item, or cancel.";

function orderActionButtons(): { id: string; title: string }[] {
  return [
    { id: encodeReplyId({ kind: "anythingElse", done: true }), title: "Confirm order" },
    { id: encodeReplyId({ kind: "anythingElse", done: false }), title: "Add to order" },
    { id: encodeReplyId({ kind: "confirm", answer: "cancel" }), title: "Cancel order" },
  ];
}

/**
 * A short basket stays on the buttons. A long one is a text message (WhatsApp
 * allows 4096 characters there) plus a short button message, so the list is
 * not cut off at the 1024-character interactive limit.
 */
export function orderProgressMessages(order: FullOrder, store: Store): OutboundMessage[] {
  const buttons = orderActionButtons();
  const basket = keepAddingBody(order, store);
  const inline = `${basket}\n\n${CONFIRM_PROMPT}`;
  const fits = inline.length <= WA_LIMITS.interactiveBody && !basket.includes("earlier") && !basket.endsWith("\u2026");
  if (fits) return [{ kind: "buttons", body: inline, buttons }];

  const detail = clamp(`So far:\n\n${orderLines(order, store)}\n\n*Total: ${money(store, order.totalCents)}*`, WA_LIMITS.textBody);
  return [
    { kind: "text", text: detail },
    {
      kind: "buttons",
      body: `${order.items.length} items on this order.\n*Total: ${money(store, order.totalCents)}*\n\n${CONFIRM_PROMPT}`,
      buttons,
    },
  ];
}

/** Confirm, add another item, or cancel. These are buttons, so they are visible without opening a list. */
export function orderActionsMessage(order: FullOrder, store: Store): OutboundMessage {
  const messages = orderProgressMessages(order, store);
  return messages.find((message) => message.kind === "buttons") ?? messages[0];
}

export function missedItemsMessage(clauses: string[]): OutboundMessage {
  const shown = clauses.map((clause) => clause.trim()).filter(Boolean).slice(0, 3);
  const list = shown.map((clause) => `"${clause}"`).join(", ");
  return {
    kind: "text",
    text: `I didn't catch ${list}, so that is not on the order. Type it again, or tap Add to order and pick it from the menu.`,
  };
}

/** Several dishes fit the same words. Ask, instead of adding the wrong one. */
export function clarifyItemsMessage(groups: { clause: string; names: string[] }[]): OutboundMessage {
  const lines = groups.slice(0, 2).map((group) => {
    const names = group.names.slice(0, 4).join(", ");
    return `"${group.clause.trim()}" could be ${names}.`;
  });
  return { kind: "text", text: `${lines.join(" ")} Tell me which one.` };
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

function stillNeedsGroup(order: FullOrder, groupId: string): FullOrderItem[] {
  return order.items.filter((item) => {
    const itemLink = item.menuItem.modifierLinks.find((link) => link.modifierGroupId === groupId && link.required);
    if (!itemLink) return false;
    if (itemLink.scope === "MEAL_ONLY" && item.isMeal !== true) return false;
    return !item.modifiers.some((modifier) => modifier.groupId === groupId);
  });
}

/** Name the item, and when several items still need a spice, say which one this list is for. */
function modifierPrompt(order: FullOrder, item: FullOrderItem, link: ItemModifierLink, prompt: string): string {
  const waiting = stillNeedsGroup(order, link.modifierGroupId);
  const spice = link.group.options.some((option) => /lemon|mild|hot|dynamite/i.test(option.name));
  if (waiting.length < 2) return `${forItem(order, item)}${prompt}`;
  const place = Math.max(1, waiting.findIndex((candidate) => candidate.id === item.id) + 1);
  const which = `For your ${item.nameSnapshot} (${place} of ${waiting.length}): ${prompt}`;
  if (!spice) return which;
  return `${which}\n\nTap a spice for this item only. Type all hot if every item still waiting should be the same.`;
}

function choiceListLabel(groupName: string): string {
  // "Soft drink flavour" contains both words. Drinks are not a spice.
  if (/zee|spice/i.test(groupName)) return "Choose spice";
  if (/drink|water|appletiser|grapetiser/i.test(groupName)) return "Choose a drink";
  if (/bambino|kids/i.test(groupName)) return "Choose a meal";
  if (/flavour|flavor|freezo|shake/i.test(groupName)) return "Choose flavour";
  if (/size|portion/i.test(groupName)) return "Choose a size";
  if (/filling|topping/i.test(groupName)) return "Choose filling";
  if (/sauce|mayo/i.test(groupName)) return "Choose a sauce";
  if (/dip/i.test(groupName)) return "Choose a dip";
  if (/chips|salad|side/i.test(groupName)) return "Choose a side";
  const label = `Choose ${groupName.toLowerCase()}`;
  return label.length <= WA_LIMITS.listButtonLabel ? label : "Choose";
}

function withOptionDescriptions(body: string, options: { name: string; description?: string | null }[]): string {
  const lines = options
    .map((option) => (option.description?.trim() ? `• ${option.name} — ${option.description.trim()}` : null))
    .filter((line): line is string => Boolean(line));
  if (!lines.length) return body;
  return clamp(`${body}\n\n${lines.join("\n")}`, WA_LIMITS.interactiveBody);
}

export function modifierQuestionMessage(order: FullOrder, item: FullOrderItem, link: ItemModifierLink, store: Store): OutboundMessage {
  const group = link.group;
  const options = group.options.filter((o) => o.available);
  const body = withOptionDescriptions(modifierPrompt(order, item, link, group.prompt), options);

  const label = (name: string, delta: number) => (delta > 0 ? `${name} (+${money(store, delta)})` : name);
  const namesFitButtons = options.length <= WA_LIMITS.maxButtons && options.every((o) => label(o.name, o.priceDeltaCents).length <= WA_LIMITS.buttonTitle);

  if (group.selection === "SINGLE" && namesFitButtons) {
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

  const rows: ListRow[] = options.map((o) => {
    const priced = label(o.name, o.priceDeltaCents);
    const titleFits = priced.length <= WA_LIMITS.rowTitle;
    const priceNote = o.priceDeltaCents > 0 ? `+${money(store, o.priceDeltaCents)}` : "";
    const description = titleFits
      ? (o.description ?? undefined)
      : [o.description?.trim(), priceNote].filter(Boolean).join(" · ") || undefined;
    return {
      id: encodeReplyId({ kind: "modifier", orderItemId: item.id, optionId: o.id }),
      title: titleFits ? priced : o.name,
      description,
    };
  });
  if (!link.required) {
    rows.push({ id: encodeReplyId({ kind: "modifierSkip", orderItemId: item.id, groupId: group.id }), title: "No thanks" });
  }

  return {
    kind: "list",
    body,
    footer: TYPE_THE_REST,
    buttonLabel: choiceListLabel(group.name),
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

export function itemNotesMessage(item: FullOrderItem): OutboundMessage {
  const choices = describeItemChoices(item);
  const named = choices ? `${item.nameSnapshot} (${choices})` : item.nameSnapshot;
  return {
    kind: "buttons",
    body: `${named}. Anything to leave out, or an allergy? Type it, for example no tomato or no lettuce. Tap No notes if it can be made as it is.`,
    buttons: [{ id: encodeReplyId({ kind: "itemNote", orderItemId: item.id, skip: true }), title: "No notes" }],
  };
}

export const COLLECTION_ONLY_MESSAGE: OutboundMessage = {
  kind: "text",
  text: "Delivery is off for now. This order is collection from the shop, and you pay at the till.",
};

export function fulfilmentMessage(store: Store): OutboundMessage {
  const fee = store.deliveryFeeCents > 0
    ? `Delivery is ${money(store, store.deliveryFeeCents)}, added to the total.`
    : "Delivery is free.";
  return {
    kind: "buttons",
    body: `Would you like delivery?\n\n${fee} Collection is from the shop, and you pay at the till.`,
    buttons: [
      { id: encodeReplyId({ kind: "fulfilment", mode: "DELIVERY" }), title: "Yes, deliver" },
      { id: encodeReplyId({ kind: "fulfilment", mode: "COLLECTION" }), title: "I'll collect" },
    ],
  };
}

export function deliveryAddressMessage(store: Store): OutboundMessage {
  const fee = store.deliveryFeeCents > 0
    ? `Delivery is ${money(store, store.deliveryFeeCents)}. That is added to the total.`
    : "Delivery is free.";
  return {
    kind: "text",
    text: [
      fee,
      `Where in ${store.city} should we deliver it?`,
      "",
      "Type the street address. Put a note for the driver on the next line if you need one, for example a gate code.",
      "",
      "Or send your WhatsApp location pin. You can add a note after the pin.",
    ].join("\n"),
  };
}

export function deliveryNoteMessage(): OutboundMessage {
  return {
    kind: "buttons",
    body: "Any note for the driver? A gate code, flat number, or where to stop. Type it, or tap No note.",
    buttons: [{ id: encodeReplyId({ kind: "deliveryNote", skip: true }), title: "No note" }],
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
    return `This is your receipt, including delivery. Accept it and I will send it to the kitchen — about ${prepMinutes} minutes, to ${order.deliveryAddress.trim()}. Pay the driver. Decline if you don't want it.`;
  }
  return `This is your receipt. Accept it and I will send it to the kitchen — about ${prepMinutes} minutes, collect from ${store.addressLine}. Pay at the till. Decline if you don't want it.`;
}

export function confirmationMessages(order: FullOrder, store: Store, prepMinutes: number): OutboundMessage[] {
  const summary = orderSummaryText(order, store);
  const question = confirmationQuestion(order, store, prepMinutes);
  const buttons = [
    { id: encodeReplyId({ kind: "confirm", answer: "yes" as const }), title: "Accept" },
    { id: encodeReplyId({ kind: "confirm", answer: "cancel" as const }), title: "Decline" },
  ];

  const inline = `🧾 *Your receipt*\n\n${summary}\n\n${question}`;
  if (inline.length <= MAX_SUMMARY_IN_BODY) {
    return [{ kind: "buttons", body: inline, buttons }];
  }

  // Large baskets (often over R1 000) must not be truncated off the receipt.
  const header = "🧾 *Your receipt*\n\n";
  const chunks = chunkWhatsAppText(`${header}${summary}`, WA_LIMITS.textBody);
  return [
    ...chunks.map((text) => ({ kind: "text" as const, text })),
    { kind: "buttons", body: clamp(question, WA_LIMITS.interactiveBody), buttons },
  ];
}

/** Split a long receipt on line breaks so every item still reaches WhatsApp. */
function chunkWhatsAppText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length <= max) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (line.length <= max) {
      current = line;
      continue;
    }
    // A single oversized line — hard-split rather than drop it.
    for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
    current = "";
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [clamp(text, max)];
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
