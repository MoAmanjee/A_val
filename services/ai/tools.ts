import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { ToolDefinition } from "@/services/ai/llm";
import { handOverToHuman, sendToCustomer, setPendingQuestion } from "@/services/conversations";
import { advanceFlow, applyConfirmation, askToConfirmCancel } from "@/services/conversations/flow";
import { readConfirmation } from "@/services/conversations/understanding";
import { sendMenuPictures } from "@/services/menu/images";
import { getCategories, getFullMenu, getStoreFaqs, isDecisive, rankByName, searchMenuItems } from "@/services/menu";
import { HANDOVER_MESSAGE, describeItemChoices, itemPriceLine, storeName } from "@/services/messaging/templates";
import {
  addItem,
  clearItems,
  findDraft,
  getOrCreateDraft,
  loadOrder,
  removeItem,
  setItemNotes,
  setMealUpgrade,
  setModifierSelection,
  setOrderNotes,
  setQuantity,
} from "@/services/orders/cart";
import { cancelEligibility, cancelOrder, estimateReadyAt, findActiveOrder, findLatestOrder } from "@/services/orders/lifecycle";
import type { FullOrder, FullOrderItem } from "@/services/orders/query";
import { missingRequirements } from "@/services/orders/requirements";
import { formatCents } from "@/utils/money";
import { formatClock, isOpenAt } from "@/utils/time";

/**
 * The only things the agent can do.
 *
 * The agent exists to understand the customer, not to run the shop. It can read
 * the menu, change the basket and look up facts; it cannot invent a price, edit
 * the menu, or move an order through the kitchen. It also cannot place an order
 * out of the blue: `confirm_order` only works when the customer has already been
 * shown the summary and asked to confirm it, which keeps the rule that nothing
 * reaches the kitchen without the customer seeing the total first.
 */

export interface ToolContext {
  storeId: string;
  conversationId: string;
}

export interface ToolResult {
  data: Record<string, unknown>;
  /**
   * The tool has fully handled this turn: it sent what the customer needs, so
   * the caller should neither send the model's reply nor advance the flow.
   */
  stop?: boolean;
}

interface ToolSpec {
  def: ToolDefinition;
  schema: z.ZodTypeAny;
  run: (ctx: ToolContext, args: never) => Promise<ToolResult>;
}

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const bool = (description: string) => ({ type: "boolean", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

async function store(ctx: ToolContext) {
  return db.store.findUniqueOrThrow({ where: { id: ctx.storeId } });
}

function money(cents: number, symbol: string) {
  return formatCents(cents, symbol);
}

// ---------------------------------------------------------------- Views

function itemView(item: FullOrderItem, symbol: string) {
  return {
    item_id: item.id,
    name: item.nameSnapshot,
    quantity: item.quantity,
    is_meal: item.isMeal,
    choices: describeItemChoices(item) || null,
    chosen_options: item.modifiers.map((m) => ({ group: m.groupNameSnapshot, option: m.optionNameSnapshot })),
    notes: item.notes,
    line_total: money(item.lineTotalCents, symbol),
  };
}

function orderView(order: FullOrder) {
  const symbol = order.store.currencySymbol;
  const missing = missingRequirements(order).map((r) =>
    r.kind === "MODIFIER"
      ? { item_id: r.item.id, item: r.item.nameSnapshot, needs: r.link.group.name }
      : { item_id: r.item.id, item: r.item.nameSnapshot, needs: "meal or on its own" },
  );
  return {
    order_id: order.id,
    order_number: order.orderNumber,
    status: order.status,
    items: order.items.map((i) => itemView(i, symbol)),
    total: money(order.totalCents, symbol),
    delivery_fee: order.fulfilment === "DELIVERY" ? (order.deliveryFeeCents > 0 ? money(order.deliveryFeeCents, symbol) : "free") : null,
    notes: order.notes,
    fulfilment: order.fulfilment,
    delivery_address: order.deliveryAddress,
    still_needed: missing,
    note: missing.length
      ? "The ordering system will ask the customer about these itself - do not ask about them in your reply."
      : order.fulfilment === "DELIVERY" && !order.deliveryAddress
        ? "The ordering system will ask for the delivery address - do not ask for it yourself."
        : order.fulfilment
          ? "Nothing outstanding; the system will show the summary and ask the customer to confirm."
          : "The ordering system will ask whether this is collection or delivery - do not ask that yourself.",
  };
}

const EMPTY_ORDER = { items: [], total: null, note: "The basket is empty." };

// ---------------------------------------------------------------- Choice resolution

interface ChoiceOutcome {
  choice: string;
  applied: boolean;
  group?: string;
  option?: string;
  reason?: string;
}

/**
 * Apply loose words like "hot", "coke" or "extra cheese" to whichever modifier
 * group of this item actually offers them. Searching every group rather than
 * trusting the model to name the group means "hot" lands on basting and "coke"
 * lands on the meal drink without the model knowing the menu structure.
 *
 * Naming a drink or a side also implies the customer wants a meal, so the
 * upgrade is applied first.
 */
async function applyChoices(orderId: string, orderItemId: string, choices: string[]): Promise<ChoiceOutcome[]> {
  const outcomes: ChoiceOutcome[] = [];

  for (const choice of choices) {
    const order = await loadOrder(orderId);
    const item = order.items.find((i) => i.id === orderItemId);
    if (!item) {
      outcomes.push({ choice, applied: false, reason: "That item is no longer in the basket" });
      continue;
    }

    let best: { groupId: string; groupName: string; optionId: string; optionName: string; mealOnly: boolean; score: number } | null = null;
    for (const link of item.menuItem.modifierLinks) {
      const ranked = rankByName(choice, link.group.options.filter((o) => o.available), (o) => o.name);
      if (!isDecisive(ranked)) continue;
      const top = ranked[0];
      if (!best || top.score > best.score) {
        best = {
          groupId: link.modifierGroupId,
          groupName: link.group.name,
          optionId: top.value.id,
          optionName: top.value.name,
          mealOnly: link.scope === "MEAL_ONLY",
          score: top.score,
        };
      }
    }

    if (!best) {
      outcomes.push({ choice, applied: false, reason: `${item.nameSnapshot} has no "${choice}" option` });
      continue;
    }

    try {
      if (best.mealOnly && item.isMeal !== true) await setMealUpgrade(orderId, orderItemId, true);
      await setModifierSelection(orderId, orderItemId, best.groupId, [best.optionId]);
      outcomes.push({ choice, applied: true, group: best.groupName, option: best.optionName });
    } catch (e) {
      outcomes.push({ choice, applied: false, reason: e instanceof Error ? e.message : "Could not apply that" });
    }
  }
  return outcomes;
}

/** Resolve "the burger" or an item id against what is already in the basket. */
function resolveBasketItem(order: FullOrder, ref: string): FullOrderItem | { candidates: FullOrderItem[] } {
  const byId = order.items.find((i) => i.id === ref);
  if (byId) return byId;
  const ranked = rankByName(ref, order.items, (i) => i.nameSnapshot);
  if (isDecisive(ranked)) return ranked[0].value;
  return { candidates: ranked.map((r) => r.value) };
}

// ---------------------------------------------------------------- Tools

const TOOLS: Record<string, ToolSpec> = {
  get_menu: {
    def: {
      name: "get_menu",
      description:
        "The full menu with current prices, meal upgrade prices and what is sold out. Use this before talking about prices or what is available. Never quote a price that did not come from here.",
      parameters: obj({ category: str("Optional category name to limit the result, e.g. 'Burgers'") }),
    },
    schema: z.object({ category: z.string().optional() }),
    run: async (ctx, args: { category?: string }) => {
      const s = await store(ctx);
      const categories = await getFullMenu(ctx.storeId);
      const wanted = args.category
        ? categories.filter((c) => rankByName(args.category!, [c], (x) => x.name).length > 0)
        : categories;
      return {
        data: {
          currency: s.currencySymbol,
          categories: (wanted.length ? wanted : categories).map((c) => ({
            category: c.name,
            items: c.items.map((i) => ({
              menu_item_id: i.id,
              name: i.name,
              price: money(i.priceCents, s.currencySymbol),
              meal_price: i.mealUpgradeCents !== null ? money(i.priceCents + i.mealUpgradeCents, s.currencySymbol) : null,
              description: i.description,
              sold_out: !i.available,
            })),
          })),
        },
      };
    },
  },

  find_menu_item: {
    def: {
      name: "find_menu_item",
      description:
        "Match something the customer said against the menu, e.g. '1/4 chicken' or 'cheese burger'. Returns ranked matches. If the result is not decisive, ask the customer which one they meant instead of guessing.",
      parameters: obj({ query: str("What the customer called the item") }, ["query"]),
    },
    schema: z.object({ query: z.string().min(1) }),
    run: async (ctx, args: { query: string }) => {
      const s = await store(ctx);
      const { matches, decisive } = await searchMenuItems(ctx.storeId, args.query);
      return {
        data: {
          decisive,
          matches: matches.map((m) => ({
            menu_item_id: m.value.id,
            name: m.value.name,
            price: money(m.value.priceCents, s.currencySymbol),
            comes_as_meal: m.value.mealUpgradeCents !== null,
            sold_out: !m.value.available,
            sold_out_note: m.value.soldOutNote,
            confidence: Number(m.score.toFixed(2)),
          })),
        },
      };
    },
  },

  add_items: {
    def: {
      name: "add_items",
      description:
        "Add one or more items to the customer's basket. Put everything the customer said into 'choices' as plain words (for example 'hot', 'coke', 'chips', 'extra cheese') and they will be matched to the right question for that item. Set as_meal when they asked for a meal or combo. Anything the customer did not mention is asked by the ordering system afterwards, so do not ask about basting, sides, drinks or meals yourself.",
      parameters: obj(
        {
          items: {
            type: "array",
            description: "The items to add",
            items: obj(
              {
                menu_item_id: str("Preferred: the id from find_menu_item or get_menu"),
                name: str("What the customer called it, if no id is known"),
                quantity: int("How many, defaults to 1"),
                as_meal: bool("True when the customer asked for a meal or combo"),
                choices: { type: "array", description: "Bastings, sides, drinks or extras the customer named", items: { type: "string" } },
                notes: str("Special request for this item, e.g. 'no tomato'"),
              },
              [],
            ),
          },
        },
        ["items"],
      ),
    },
    schema: z.object({
      items: z
        .array(
          z.object({
            menu_item_id: z.string().optional(),
            name: z.string().optional(),
            quantity: z.number().int().optional(),
            as_meal: z.boolean().optional(),
            choices: z.array(z.string()).optional(),
            notes: z.string().optional(),
          }),
        )
        .min(1),
    }),
    run: async (ctx, args: { items: { menu_item_id?: string; name?: string; quantity?: number; as_meal?: boolean; choices?: string[]; notes?: string }[] }) => {
      const s = await store(ctx);
      const draft = await getOrCreateDraft(ctx.conversationId);
      const added: unknown[] = [];
      const unresolved: unknown[] = [];

      for (const req of args.items) {
        let menuItemId = req.menu_item_id;
        if (!menuItemId) {
          if (!req.name) {
            unresolved.push({ requested: req, reason: "No item id or name was given" });
            continue;
          }
          const { matches, decisive } = await searchMenuItems(ctx.storeId, req.name);
          if (!decisive) {
            unresolved.push({
              requested: req.name,
              reason: matches.length ? "Several items could match - ask the customer which one" : "Not on the menu",
              candidates: matches.map((m) => ({ menu_item_id: m.value.id, name: m.value.name, price: money(m.value.priceCents, s.currencySymbol) })),
            });
            continue;
          }
          menuItemId = matches[0].value.id;
        }

        try {
          const line = await addItem(draft.id, {
            menuItemId,
            quantity: req.quantity,
            notes: req.notes,
            isMeal: req.as_meal,
          });
          const choices = req.choices?.length ? await applyChoices(draft.id, line.id, req.choices) : [];
          added.push({ item_id: line.id, name: line.nameSnapshot, quantity: line.quantity, choices });
        } catch (e) {
          unresolved.push({ requested: req.name ?? menuItemId, reason: e instanceof Error ? e.message : "Could not add that" });
        }
      }

      const order = await loadOrder(draft.id);
      return { data: { added, unresolved, order: orderView(order) } };
    },
  },

  view_order: {
    def: {
      name: "view_order",
      description: "What is in the customer's basket right now, with line totals and anything still outstanding.",
      parameters: obj({}),
    },
    schema: z.object({}),
    run: async (ctx) => {
      const draft = await findDraft(ctx.conversationId);
      return { data: draft ? orderView(draft) : EMPTY_ORDER };
    },
  },

  change_item: {
    def: {
      name: "change_item",
      description:
        "Change something already in the basket: the quantity, the meal upgrade, a basting, a side, a drink, extras, or a note. Use this when the customer corrects themselves.",
      parameters: obj(
        {
          item: str("The item_id from view_order, or what the customer called it"),
          quantity: int("New quantity. 0 removes the line"),
          as_meal: bool("True for a meal, false for the item on its own"),
          choices: { type: "array", description: "New bastings, sides, drinks or extras", items: { type: "string" } },
          notes: str("Replacement note for this line, or an empty string to clear it"),
        },
        ["item"],
      ),
    },
    schema: z.object({
      item: z.string().min(1),
      quantity: z.number().int().optional(),
      as_meal: z.boolean().optional(),
      choices: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }),
    run: async (ctx, args: { item: string; quantity?: number; as_meal?: boolean; choices?: string[]; notes?: string }) => {
      const draft = await findDraft(ctx.conversationId);
      if (!draft) return { data: EMPTY_ORDER };
      const found = resolveBasketItem(draft, args.item);
      if ("candidates" in found) {
        return {
          data: {
            error: "Could not tell which item was meant - ask the customer",
            candidates: found.candidates.map((i) => ({ item_id: i.id, name: i.nameSnapshot })),
          },
        };
      }

      let choiceOutcomes: ChoiceOutcome[] = [];
      try {
        if (args.quantity !== undefined) await setQuantity(draft.id, found.id, args.quantity);
        if (args.quantity !== 0) {
          if (args.as_meal !== undefined) await setMealUpgrade(draft.id, found.id, args.as_meal);
          if (args.notes !== undefined) await setItemNotes(draft.id, found.id, args.notes.trim() || null);
          if (args.choices?.length) choiceOutcomes = await applyChoices(draft.id, found.id, args.choices);
        }
      } catch (e) {
        return { data: { error: e instanceof Error ? e.message : "Could not change that" } };
      }

      const order = await loadOrder(draft.id);
      return { data: { changed: true, choices: choiceOutcomes, order: orderView(order) } };
    },
  },

  remove_item: {
    def: {
      name: "remove_item",
      description: "Take an item out of the basket.",
      parameters: obj({ item: str("The item_id from view_order, or what the customer called it") }, ["item"]),
    },
    schema: z.object({ item: z.string().min(1) }),
    run: async (ctx, args: { item: string }) => {
      const draft = await findDraft(ctx.conversationId);
      if (!draft) return { data: EMPTY_ORDER };
      const found = resolveBasketItem(draft, args.item);
      if ("candidates" in found) {
        return {
          data: {
            error: "Could not tell which item was meant - ask the customer",
            candidates: found.candidates.map((i) => ({ item_id: i.id, name: i.nameSnapshot })),
          },
        };
      }
      const order = await removeItem(draft.id, found.id);
      return { data: { removed: found.nameSnapshot, order: order.items.length ? orderView(order) : EMPTY_ORDER } };
    },
  },

  clear_order: {
    def: {
      name: "clear_order",
      description: "Empty the basket and start again. Only use this when the customer asks to start over.",
      parameters: obj({}),
    },
    schema: z.object({}),
    run: async (ctx) => {
      const draft = await findDraft(ctx.conversationId);
      if (!draft) return { data: EMPTY_ORDER };
      await clearItems(draft.id);
      await db.conversation.update({ where: { id: ctx.conversationId }, data: { askedAnythingElse: false } });
      await setPendingQuestion(ctx.conversationId, "NONE");
      return { data: { cleared: true, ...EMPTY_ORDER } };
    },
  },

  set_order_notes: {
    def: {
      name: "set_order_notes",
      description: "A note for the whole order that the kitchen should see, e.g. 'please pack separately'.",
      parameters: obj({ notes: str("The note, or an empty string to clear it") }, ["notes"]),
    },
    schema: z.object({ notes: z.string() }),
    run: async (ctx, args: { notes: string }) => {
      const draft = await findDraft(ctx.conversationId);
      if (!draft) return { data: EMPTY_ORDER };
      await setOrderNotes(draft.id, args.notes.trim() || null);
      return { data: { notes_set: true } };
    },
  },

  request_order_confirmation: {
    def: {
      name: "request_order_confirmation",
      description:
        "Show the customer the full order summary with the total and ask them to confirm it. Use this when they say they are finished ordering. Do not write the summary yourself - this sends it.",
      parameters: obj({}),
    },
    schema: z.object({}),
    run: async (ctx) => {
      const draft = await findDraft(ctx.conversationId);
      if (!draft || !draft.items.length) return { data: EMPTY_ORDER };
      await db.conversation.update({ where: { id: ctx.conversationId }, data: { askedAnythingElse: true } });
      const result = await advanceFlow(ctx.conversationId);
      return { data: { summary_sent: result.sent }, stop: result.sent };
    },
  },

  confirm_order: {
    def: {
      name: "confirm_order",
      description:
        "Record that the customer agreed to the order summary, which sends it to the kitchen. Only call this when the customer has just been shown the summary and their reply clearly means yes. If they did not clearly agree, do not call this.",
      parameters: obj({ customer_said: str("The customer's exact words that mean yes") }, ["customer_said"]),
    },
    schema: z.object({ customer_said: z.string() }),
    run: async (ctx, args: { customer_said: string }) => {
      const conv = await db.conversation.findUniqueOrThrow({ where: { id: ctx.conversationId } });
      // Guard rail: an order can only be placed in answer to a confirmation the
      // customer was actually shown.
      if (conv.pendingQuestion !== "ORDER_CONFIRMATION") {
        return {
          data: {
            error: "The customer has not been shown an order summary to confirm. Call request_order_confirmation first.",
          },
        };
      }
      if (readConfirmation(args.customer_said) !== "yes") {
        return {
          data: {
            error: "That reply is not a clear yes. Do not place the order. If they want a change, update the basket. Otherwise ask them to confirm.",
          },
        };
      }
      const result = await applyConfirmation(conv, "yes");
      return { data: { confirmed: true, customer_said: args.customer_said }, stop: result.sent };
    },
  },

  cancel_order: {
    def: {
      name: "cancel_order",
      description:
        "Handle a request to cancel. This checks whether it is still allowed and asks the customer to confirm. Read the result before replying: when it is too late, explain why and offer to put a staff member on.",
      parameters: obj({}),
    },
    schema: z.object({}),
    run: async (ctx) => {
      const s = await store(ctx);
      const draft = await findDraft(ctx.conversationId);
      if (draft && draft.items.length) {
        await cancelOrder(draft.id, { by: "CUSTOMER", reason: "Customer cancelled before the order went to the kitchen", actor: "customer", notify: false });
        await db.conversation.update({
          where: { id: ctx.conversationId },
          data: { askedAnythingElse: false, pendingQuestion: "NONE", pendingContext: Prisma.DbNull },
        });
        return { data: { cancelled: true, was_in_kitchen: false, note: "The basket was cleared. Confirm that to the customer." } };
      }

      const active = await findActiveOrder(ctx.conversationId);
      if (!active) return { data: { error: "There is no open order to cancel" } };

      const eligibility = cancelEligibility(active, s);
      if (!eligibility.allowed) {
        return {
          data: {
            order_number: active.orderNumber,
            cancelled: false,
            allowed: false,
            needs_staff: eligibility.needsStaff,
            reason: eligibility.reason,
          },
        };
      }
      const result = await askToConfirmCancel(ctx.conversationId, active.id);
      return { data: { order_number: active.orderNumber, asked_customer_to_confirm: true }, stop: result.sent };
    },
  },

  get_order_status: {
    def: {
      name: "get_order_status",
      description:
        "Where the customer's order is: whether the kitchen has it, the collection time, and whether they can still cancel. Use this for 'what time will it be ready?', 'is it ready?' and 'can I cancel?'.",
      parameters: obj({}),
    },
    schema: z.object({}),
    run: async (ctx) => {
      const s = await store(ctx);
      const order = (await findActiveOrder(ctx.conversationId)) ?? (await findLatestOrder(ctx.conversationId));
      const draft = await findDraft(ctx.conversationId);
      if (!order) {
        return {
          data: {
            open_order: null,
            basket: draft && draft.items.length ? orderView(draft) : EMPTY_ORDER,
            note: "No order has been sent to the kitchen yet.",
          },
        };
      }

      const readyAt = estimateReadyAt(order, s);
      const eligibility = cancelEligibility(order, s);
      return {
        data: {
          order_number: order.orderNumber,
          status: order.status,
          kitchen_has_acknowledged: Boolean(order.acknowledgedAt),
          total: money(order.totalCents, s.currencySymbol),
          /** Null until the kitchen commits to a time. */
          collection_time: readyAt ? formatClock(readyAt, s.timezone) : null,
          collection_time_is_estimate: !order.promisedReadyAt,
          ready_now: order.status === "READY_FOR_COLLECTION",
          collected: order.status === "COLLECTED",
          can_still_cancel: eligibility.allowed,
          cancel_note: eligibility.reason,
          items: order.items.map((i) => ({ name: i.nameSnapshot, quantity: i.quantity, choices: describeItemChoices(i) || null })),
        },
      };
    },
  },

  get_store_info: {
    def: {
      name: "get_store_info",
      description:
        "Facts about the branch: address, whether it is open now, trading hours, how long food takes, how to pay, and the answers staff have written to common questions. Use this instead of guessing.",
      parameters: obj({}),
    },
    schema: z.object({}),
    run: async (ctx) => {
      const s = await store(ctx);
      const hours = await db.tradingHour.findMany({ where: { storeId: s.id }, orderBy: { dayOfWeek: "asc" } });
      const faqs = await getStoreFaqs(s.id);
      const openState = isOpenAt(hours, new Date(), s.timezone);
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return {
        data: {
          name: storeName(s),
          address: [s.addressLine, s.suburb, s.city].filter(Boolean).join(", "),
          phone: s.phone ? `+${s.phone}` : null,
          open_now: openState.open,
          opens_at: openState.opensAt ?? null,
          closes_at: openState.closesAt ?? null,
          trading_hours: hours.map((h) => ({ day: days[h.dayOfWeek], hours: h.closed ? "Closed" : `${h.opensAt} - ${h.closesAt}` })),
          typical_prep_minutes: s.defaultPrepMinutes,
          accepting_whatsapp_orders: s.acceptingOrders,
          fulfilment:
            `Collection from the shop, or delivery in Potchefstroom. The shop's delivery amount is ${s.deliveryFeeCents > 0 ? money(s.deliveryFeeCents, s.currencySymbol) : "free"}. Do not quote a different fee.`,
          answers: faqs.map((f) => ({ question: f.question, answer: f.answer })),
        },
      };
    },
  },

  set_customer_name: {
    def: {
      name: "set_customer_name",
      description: "Save the name the customer gives for themselves, so the kitchen can call it out at collection.",
      parameters: obj({ name: str("The customer's first name") }, ["name"]),
    },
    schema: z.object({ name: z.string().min(1).max(60) }),
    run: async (ctx, args: { name: string }) => {
      const conv = await db.conversation.findUniqueOrThrow({ where: { id: ctx.conversationId } });
      await db.customer.update({ where: { id: conv.customerId }, data: { name: args.name.trim() } });
      return { data: { name_saved: args.name.trim() } };
    },
  },

  send_menu_pictures: {
    def: {
      name: "send_menu_pictures",
      description:
        "Send the printed menu pictures to the customer, and the PDF when they asked for a file. Use this when they want to see the menu. Do not describe the pages yourself.",
      parameters: obj({ include_pdf: bool("True only when they asked for a PDF or a file to download") }),
    },
    schema: z.object({ include_pdf: z.boolean().optional() }),
    run: async (ctx, args: { include_pdf?: boolean }) => {
      const sent = await sendMenuPictures(ctx.conversationId, { includePdf: Boolean(args.include_pdf), force: true });
      return {
        data: sent
          ? { pictures_sent: sent }
          : { pictures_sent: 0, error: "The menu pictures are not available. Offer the tappable menu instead." },
        stop: sent > 0,
      };
    },
  },

  request_human_handoff: {
    def: {
      name: "request_human_handoff",
      description:
        "Put a staff member on the chat. Use this when the customer asks for a person, is upset, wants a refund or a complaint handled, asks about something you cannot do, or when an order needs changing after the kitchen has started.",
      parameters: obj({ reason: str("Short reason for the staff queue") }, ["reason"]),
    },
    schema: z.object({ reason: z.string().min(1) }),
    run: async (ctx, args: { reason: string }) => {
      await handOverToHuman(ctx.conversationId, args.reason);
      await sendToCustomer(ctx.conversationId, HANDOVER_MESSAGE, "AI");
      return { data: { handed_to_staff: true }, stop: true };
    },
  },
};

export const toolDefinitions: ToolDefinition[] = Object.values(TOOLS).map((t) => t.def);

/** Available for the menu page and docs, so prices shown match what the AI sees. */
export { itemPriceLine };

export async function executeTool(ctx: ToolContext, name: string, rawArgs: string): Promise<ToolResult> {
  const spec = TOOLS[name];
  if (!spec) return { data: { error: `Unknown tool "${name}"` } };

  let parsed: unknown;
  try {
    parsed = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return { data: { error: "Arguments were not valid JSON" } };
  }

  try {
    const args = spec.schema.parse(parsed);
    return await spec.run(ctx, args as never);
  } catch (e) {
    // Tool failures are reported back to the model so it can recover in the
    // same turn, rather than thrown and surfaced to the customer.
    if (e instanceof ZodError) {
      return { data: { error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") } };
    }
    if (e instanceof AppError) return { data: { error: e.message } };
    console.error(`[ai] tool ${name} failed`, e);
    return { data: { error: e instanceof Error ? e.message : "The tool failed" } };
  }
}

/** Exported for the agent's own use when describing categories in a reply. */
export async function listCategoryNames(storeId: string): Promise<string[]> {
  return (await getCategories(storeId)).map((c) => c.name);
}
