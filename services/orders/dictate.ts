import type { Fulfilment } from "@prisma/client";
import { db } from "@/lib/db";
import { normalise } from "@/services/conversations/understanding";
import { normaliseMenuText, tokensRoughlyEqual } from "@/services/menu/matching";
import type { MenuSeed } from "@/db/menu";
import { addItem, findDraft, getOrCreateDraft, loadOrder, setFulfilment, setItemNotes, setMealUpgrade, setModifierSelection, setQuantity } from "@/services/orders/cart";
import { DELIVERY_ENABLED } from "@/services/orders/features";
import { missingRequirements, nextRequirement } from "@/services/orders/requirements";
import type { FullOrder, FullOrderItem } from "@/services/orders/query";

/**
 * Read a whole order out of one message.
 *
 * "Hot quarter chicken meal with a Coke, delivery to 14 Kock Street" already
 * answers flavour, meal, drink, and where it is going. The flow then asks only
 * for what that message left out, instead of walking every slot.
 */

export interface DictationOption {
  id: string;
  name: string;
  groupId: string;
  scope: "ALWAYS" | "MEAL_ONLY";
  selection: "SINGLE" | "MULTIPLE";
}

export interface DictationItem {
  id: string;
  name: string;
  shortName: string | null;
  canBeMeal: boolean;
  options: DictationOption[];
}

export interface ParsedSelection {
  groupId: string;
  optionIds: string[];
  mealOnly: boolean;
}

export interface ParsedLine {
  item: DictationItem;
  quantity: number;
  /** Null means the customer never said, so the bot still asks. */
  isMeal: boolean | null;
  selections: ParsedSelection[];
  /** "another" / "one more" adds a second line instead of editing the first. */
  forceNew: boolean;
  /** "no tomato" typed with the item, so the bot does not ask again. */
  notes: string | null;
}

export interface ParsedUtterance {
  lines: ParsedLine[];
  fulfilment: Fulfilment | null;
  deliveryAddress: string | null;
  /** A question such as "do you deliver?" with no item in it. Not an order. */
  ignoredAsQuestion: boolean;
  /** Clauses that named food the menu matcher could not place. */
  unmatched: string[];
  /** A clause that fits several dishes, so the bot asks which one. */
  ambiguous: { clause: string; names: string[] }[];
}

const QUESTION = /^(do|does|can|could|what|whats|where|wheres|when|how|is|are|wat|waar|wanneer|hoe)\b|\?/;
const DELIVERY_WORD = String.raw`deliver(?:y|ed)?|drop(?:\s+it)?\s*off|drop\s*off|bring(?:\s+it)?(?:\s+round)?`;
const ANOTHER = /\b(another|one more|a second|extra one)\b/i;
const MEAL_NO = /\b(on its own|by itself|no meal|not a meal|without (a )?meal|not as a meal)\b/;
const MEAL_YES = /\b(meals?|combo|as a meal|make it a meal)\b/;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export function catalogFromMenu(menu: MenuSeed): DictationItem[] {
  const groups = new Map(menu.modifierGroups.map((group) => [group.name, group]));
  const items: DictationItem[] = [];
  for (const category of menu.categories) {
    for (const item of category.items) {
      const options: DictationOption[] = [];
      for (const ref of item.modifiers ?? []) {
        const group = groups.get(ref.group);
        if (!group) continue;
        for (const option of group.options) {
          options.push({
            id: `${item.name}:${group.name}:${option.name}`,
            name: option.name,
            groupId: group.name,
            scope: ref.scope ?? "ALWAYS",
            selection: group.selection,
          });
        }
      }
      items.push({
        id: item.name,
        name: item.name,
        shortName: item.shortName ?? null,
        canBeMeal: item.mealUpgradeCents != null,
        options,
      });
    }
  }
  return items;
}

export function parseUtterance(raw: string, catalog: DictationItem[]): ParsedUtterance {
  const empty: ParsedUtterance = {
    lines: [],
    fulfilment: null,
    deliveryAddress: null,
    ignoredAsQuestion: false,
    unmatched: [],
    ambiguous: [],
  };
  const trimmed = raw.trim();
  if (!trimmed) return empty;
  if (isQuestionWithoutItem(trimmed, catalog)) return { ...empty, ignoredAsQuestion: true };

  const peeled = peelFulfilment(trimmed);
  // Newline / "2x" lists must become separate clauses, or every line inherits the
  // first quantity and big orders (often over R1 000) lose items and totals.
  const clauses = splitClauses(tidyOrderText(peeled.text), catalog);
  const lines: ParsedLine[] = [];
  const unmatched: string[] = [];
  const ambiguous: { clause: string; names: string[] }[] = [];

  const rememberMiss = (clause: string, readable: string) => {
    if (!looksLikeMissedFood(readable)) return;
    unmatched.push(clause);
    const names = closeMenuNames(readable, catalog);
    if (names.length) ambiguous.push({ clause, names });
  };

  for (const clause of clauses) {
    const readable = glueMenuWords(clause, catalog);
    const peeled = peelItemNote(readable);
    const food = peeled.note ? peeled.food : readable;
    const built = linesFromClause(food, catalog);
    if (built.length) {
      if (peeled.note) built[built.length - 1].notes = appendNote(built[built.length - 1].notes, peeled.note);
      lines.push(...built);
      continue;
    }
    const previous = lines.at(-1);
    if (peeled.note && !food.trim() && previous) {
      previous.notes = appendNote(previous.notes, peeled.note);
      continue;
    }
    if (!previous) {
      const drink = standaloneDrink(food || readable, catalog);
      if (drink) {
        if (peeled.note) drink.notes = appendNote(drink.notes, peeled.note);
        lines.push(drink);
      } else rememberMiss(clause, food || readable);
      continue;
    }
    const extras = choicesForItem(food || readable, previous.item);
    const useful = extras.selections.length > 0 || extras.isMeal !== null;
    if (extras.isMeal === true) previous.isMeal = true;
    else if (extras.isMeal === false && previous.isMeal === null) previous.isMeal = false;
    mergeSelections(previous, extras.selections);
    if (peeled.note) {
      previous.notes = appendNote(previous.notes, peeled.note);
      continue;
    }
    if (!useful) rememberMiss(clause, food || readable);
  }

  const shared = sharedChoice(trimmed, catalog);
  if (shared) {
    for (const line of lines) applySharedToLine(line, shared);
  }

  return {
    lines,
    fulfilment: peeled.fulfilment,
    deliveryAddress: peeled.deliveryAddress,
    ignoredAsQuestion: false,
    unmatched,
    ambiguous,
  };
}

const MISSED_SKIP = new Set([
  "hot", "mild", "extra", "dynamite", "herb", "lemon", "peri", "meal", "meals", "combo",
  "coke", "zero", "sprite", "fanta", "buddy", "chips", "chip", "please", "thanks",
  "with", "and", "for", "the", "this", "that", "just", "also", "plus", "drink",
  "large", "small", "single", "double", "sauce", "mayo", "cheese",
]);

/** A leftover clause that still looks like a menu item, not a spice or a drink. */
function looksLikeMissedFood(clause: string): boolean {
  return normaliseMenuText(clause)
    .split(" ")
    .some((token) => token.length >= 4 && !MISSED_SKIP.has(token));
}

/** "milk shake" is one menu word. Only join a pair when the menu actually has it. */
function glueMenuWords(raw: string, catalog: DictationItem[]): string {
  const vocab = new Set<string>();
  for (const item of catalog) {
    for (const label of [item.name, item.shortName ?? "", ...item.options.map((option) => option.name)]) {
      const norm = normaliseMenuText(label);
      if (norm.length >= 5) vocab.add(norm);
      for (const token of norm.split(" ")) if (token.length >= 5) vocab.add(token);
    }
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  const glued: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const next = tokens[i + 1];
    if (next) {
      const squashed = normaliseMenuText(`${tokens[i]}${next}`);
      if (squashed.length >= 5 && vocab.has(squashed)) {
        glued.push(squashed);
        i += 1;
        continue;
      }
    }
    glued.push(tokens[i]);
  }
  return glued.join(" ");
}

function contentTokens(normalised: string): string[] {
  return normalised.split(" ").filter((token) => token.length >= 4 && !MISSED_SKIP.has(token));
}

const MENU_WORD_SKIP = new Set(["the", "and", "with", "for", "please", "thanks", "that", "this", "just", "also", "plus", "meal", "meals", "combo"]);

/** Food words, including short ones such as "ice" and "tea", and "lemon" which is also a spice. */
function menuWords(normalised: string): string[] {
  return normalised.split(" ").filter((token) => {
    if (MENU_WORD_SKIP.has(token)) return false;
    if (/^\d+$/.test(token)) return true;
    return token.length >= 3;
  });
}

function nameTokens(item: DictationItem): string[] {
  return normaliseMenuText(item.name)
    .split(" ")
    .filter((token) => /^\d+$/.test(token) || token.length >= 3);
}

/** Every food word appears in the dish name. Order does not matter, so "ice tea lemon" is still Lemon Ice Tea. */
function coversTokens(need: string[], have: string[]): boolean {
  const pool = [...have];
  for (const token of need) {
    const index = pool.findIndex((part) => part === token || tokensRoughlyEqual(part, token));
    if (index < 0) return false;
    pool.splice(index, 1);
  }
  return true;
}

/**
 * "nacho burger" contains Nachos, and also the Nacho Crunch burger.
 * Keep the item that uses every food word the customer typed.
 */
function preferFullerItem(normalised: string, hits: ItemHit[], catalog: DictationItem[]): ItemHit[] {
  const need = menuWords(normalised);
  if (need.length < 2) return hits;
  const current = hits[0];
  if (current && coversTokens(need, nameTokens(current.item))) return hits;

  const scored = catalog
    .filter((item) => !isDrinkVessel(item) && coversTokens(need, nameTokens(item)))
    .map((item) => ({ item, precision: need.length / Math.max(1, nameTokens(item).length) }))
    .sort((a, b) => b.precision - a.precision);
  const best = scored[0];
  const second = scored[1];
  const floor = need.some((token) => /^\d+$/.test(token)) ? 0.3 : 0.45;
  if (!best || best.precision < floor) return hits;
  if (second && best.precision - second.precision < 0.12) return hits;

  const span = wordSpan(normalised, need);
  return [{ item: best.item, phrase: normaliseMenuText(best.item.name), index: span.start, end: span.end }];
}

function wordSpan(normalised: string, need: string[]): { start: number; end: number } {
  const spans = tokenSpans(normalised);
  let start = 0;
  let end = normalised.length;
  let from = 0;
  for (const token of need) {
    const found = spans.slice(from).find((span) => span.token === token || tokensRoughlyEqual(span.token, token));
    if (!found) continue;
    if (from === 0) start = found.start;
    end = found.end;
    from = spans.indexOf(found) + 1;
  }
  return { start, end };
}

/** "all hot" / "both mild" names one spice for every item that does not already have one. */
export function sharedChoice(raw: string, catalog: DictationItem[]): { groupId: string; optionName: string } | null {
  if (!/\b(all|both|every|everything|same|the rest)\b/i.test(normalise(raw))) return null;
  const byKey = new Map<string, DictationOption>();
  for (const item of catalog) {
    for (const option of item.options) {
      const key = `${option.groupId}:${normaliseMenuText(option.name)}`;
      if (!byKey.has(key)) byKey.set(key, option);
    }
  }
  const virtual: DictationItem = {
    id: "shared",
    name: "shared",
    shortName: null,
    canBeMeal: false,
    options: [...byKey.values()],
  };
  const selections = matchOptions(withoutNamedItems(raw, catalog), virtual, []);
  const ranked = selections
    .map((selection) => ({ selection, option: virtual.options.find((option) => selection.optionIds.includes(option.id)) }))
    .filter((hit): hit is { selection: ParsedSelection; option: DictationOption } => Boolean(hit.option));
  const picked = ranked.find((hit) => hit.option.scope !== "MEAL_ONLY") ?? ranked[0];
  if (!picked) return null;
  return { groupId: picked.option.groupId, optionName: picked.option.name };
}

/** Drop item names so "all hot" is the spice, not the word chicken inside the order. */
function withoutNamedItems(raw: string, catalog: DictationItem[]): string {
  let text = ` ${normaliseMenuText(raw)} `;
  const phrases = catalog
    .flatMap((item) => [item.name, item.shortName ?? ""])
    .map((name) => normaliseMenuText(name))
    .filter((name) => name.length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    text = text.split(` ${phrase} `).join(" ");
  }
  return text.replace(/\s+/g, " ").trim();
}

function applySharedToLine(line: ParsedLine, shared: { groupId: string; optionName: string }) {
  if (line.selections.some((selection) => selection.groupId === shared.groupId)) return;
  const option = line.item.options.find(
    (candidate) => candidate.groupId === shared.groupId && normaliseMenuText(candidate.name) === normaliseMenuText(shared.optionName),
  );
  if (!option) return;
  if (option.scope === "MEAL_ONLY" && line.isMeal !== true) return;
  line.selections.push({ groupId: option.groupId, optionIds: [option.id], mealOnly: option.scope === "MEAL_ONLY" });
}

/** Options and the meal answer inside a fragment, for the item the customer is already on. */
export function choicesForItem(raw: string, item: DictationItem): { selections: ParsedSelection[]; isMeal: boolean | null } {
  const peeled = peelFulfilment(raw);
  const norm = normaliseMenuText(peeled.text);
  const selections = matchOptions(norm, item, []);
  return { selections, isMeal: readMeal(peeled.text, item, selections) };
}

export async function applyDictation(
  conversationId: string,
  text: string,
): Promise<{ changed: boolean; unmatched: string[]; deliveryPaused: boolean; ambiguous: { clause: string; names: string[] }[] }> {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const catalog = await loadCatalog(conv.storeId);
  const parsed = parseUtterance(text, catalog);
  const unmatched = parsed.unmatched;
  const deliveryPaused = !DELIVERY_ENABLED && parsed.fulfilment === "DELIVERY";
  const pack = (changed: boolean) => ({ changed, unmatched, deliveryPaused, ambiguous: parsed.ambiguous });
  if (parsed.ignoredAsQuestion) return pack(false);

  const existing = await findDraft(conversationId);
  const namesAFood = parsed.lines.some((line) => !isDrinkVessel(line.item));
  const shared = sharedChoice(text, catalog);
  if (shared && existing?.items.length && !namesAFood) {
    const spread = await applySharedToBasket(existing, catalog, shared);
    if (spread) {
      const current = await loadOrder(existing.id);
      await writeFulfilment(current, parsed);
      await noteAdding(conversationId, existing.id, parsed);
      return pack(true);
    }
  }

  // "extra hot meal with a coke" names no new menu row. Fold it into the item
  // already being built instead of adding a can of Coke beside it.
  if (!namesAFood && existing?.items.length) {
    const target = pickLooseTarget(existing, catalog, text);
    const entry = target ? catalog.find((item) => item.id === target.menuItemId) : undefined;
    if (target && entry) {
      const extras = choicesForItem(text, entry);
      if (extras.selections.length || extras.isMeal !== null) {
        let changed = await writeOnto(existing.id, target, {
          item: entry,
          quantity: target.quantity,
          isMeal: extras.isMeal,
          selections: extras.selections,
          forceNew: false,
          notes: null,
        });
        const current = await loadOrder(existing.id);
        if (await writeFulfilment(current, parsed)) changed = true;
        if (changed) await noteAdding(conversationId, existing.id, parsed);
        return pack(changed);
      }
    }
  }

  if (!parsed.lines.length && !parsed.fulfilment) {
    if (!existing?.items.length) return pack(false);
    const target = pickLooseTarget(existing, catalog, text);
    if (!target) return pack(false);
    const item = catalog.find((entry) => entry.id === target.menuItemId);
    if (!item) return pack(false);
    const extras = choicesForItem(text, item);
    if (!extras.selections.length && extras.isMeal === null) return pack(false);
    const changed = await writeOnto(existing.id, target, {
      item,
      quantity: target.quantity,
      isMeal: extras.isMeal,
      selections: extras.selections,
      forceNew: false,
      notes: null,
    });
    if (changed) await noteAdding(conversationId, existing.id, parsed);
    return pack(changed);
  }

  if (!parsed.lines.length) {
    if (!existing) return pack(false);
    const changed = await writeFulfilment(existing, parsed);
    if (changed) await noteAdding(conversationId, existing.id, parsed);
    return pack(changed);
  }

  const draft = existing ?? (await getOrCreateDraft(conversationId));
  let changed = false;
  let current = await loadOrder(draft.id);
  for (const line of parsed.lines) {
    const wrote = await upsertLine(current, line);
    if (wrote) changed = true;
    current = await loadOrder(draft.id);
  }
  if (await writeFulfilment(current, parsed)) changed = true;
  if (changed) await noteAdding(conversationId, draft.id, parsed);
  return pack(changed);
}

async function loadCatalog(storeId: string): Promise<DictationItem[]> {
  const rows = await db.menuItem.findMany({
    where: { storeId, active: true, available: true, category: { active: true } },
    include: {
      modifierLinks: {
        orderBy: { sortOrder: "asc" },
        include: { group: { include: { options: { where: { available: true }, orderBy: { sortOrder: "asc" } } } } },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    canBeMeal: row.mealUpgradeCents != null,
    options: row.modifierLinks.flatMap((link) =>
      link.group.options.map((option) => ({
        id: option.id,
        name: option.name,
        groupId: link.group.id,
        scope: link.scope,
        selection: link.group.selection,
      })),
    ),
  }));
}

function pickLooseTarget(order: FullOrder, catalog: DictationItem[], text: string): FullOrderItem | null {
  const missing = missingRequirements(order);
  if (missing.length) return order.items.find((item) => item.id === missing[0].item.id) ?? null;
  const candidates = order.items.filter((item) => {
    const entry = catalog.find((candidate) => candidate.id === item.menuItemId);
    if (!entry) return false;
    const extras = choicesForItem(text, entry);
    return extras.selections.length > 0 || extras.isMeal !== null;
  });
  return candidates.at(-1) ?? null;
}

async function upsertLine(order: FullOrder, line: ParsedLine): Promise<boolean> {
  const same = order.items.filter((item) => item.menuItemId === line.item.id);
  const missing = new Set(missingRequirements(order).map((requirement) => requirement.item.id));
  const incomplete = same.find((item) => missing.has(item.id));
  const target = line.forceNew ? null : (incomplete ?? (same.length === 1 ? same[0] : null));
  if (!target) {
    const created = await addItem(order.id, {
      menuItemId: line.item.id,
      quantity: line.quantity,
      isMeal: line.isMeal ?? undefined,
      notes: line.notes ?? undefined,
    });
    await applySelections(order.id, created.id, line, created);
    return true;
  }
  return writeOnto(order.id, target, line);
}

async function writeOnto(orderId: string, target: FullOrderItem, line: ParsedLine): Promise<boolean> {
  let changed = false;
  if (line.quantity > 1 && line.quantity !== target.quantity) {
    await setQuantity(orderId, target.id, line.quantity);
    changed = true;
  }
  if (line.isMeal !== null && line.isMeal !== target.isMeal) {
    await setMealUpgrade(orderId, target.id, line.isMeal);
    changed = true;
    target = { ...target, isMeal: line.isMeal };
  }
  if (await applySelections(orderId, target.id, line, target)) changed = true;
  if (line.notes) {
    const combined = appendNote(target.notes, line.notes);
    if (combined !== target.notes) {
      await setItemNotes(orderId, target.id, combined);
      changed = true;
    }
  }
  return changed;
}

async function applySelections(orderId: string, orderItemId: string, line: ParsedLine, existing: FullOrderItem): Promise<boolean> {
  let changed = false;
  let isMeal = existing.isMeal;
  if (line.selections.some((selection) => selection.mealOnly) && isMeal !== true) {
    await setMealUpgrade(orderId, orderItemId, true);
    isMeal = true;
    changed = true;
  }
  for (const selection of line.selections) {
    if (sameSelection(existing, selection) && !(selection.mealOnly && isMeal !== true)) continue;
    await setModifierSelection(orderId, orderItemId, selection.groupId, selection.optionIds);
    changed = true;
  }
  return changed;
}

function sameSelection(item: FullOrderItem, selection: ParsedSelection): boolean {
  const have = item.modifiers.filter((modifier) => modifier.groupId === selection.groupId).map((modifier) => modifier.optionId);
  if (have.length !== selection.optionIds.length) return false;
  return selection.optionIds.every((id) => have.includes(id));
}

async function writeFulfilment(order: FullOrder, parsed: ParsedUtterance): Promise<boolean> {
  if (!parsed.fulfilment) return false;
  if (parsed.fulfilment === "DELIVERY" && !DELIVERY_ENABLED) {
    if (order.fulfilment === "COLLECTION" && !order.deliveryAddress) return false;
    await setFulfilment(order.id, "COLLECTION");
    return true;
  }
  if (parsed.fulfilment === "COLLECTION") {
    if (order.fulfilment === "COLLECTION" && !order.deliveryAddress) return false;
    await setFulfilment(order.id, "COLLECTION");
    return true;
  }
  const address = parsed.deliveryAddress;
  if (order.fulfilment === "DELIVERY" && (address === null || address === order.deliveryAddress)) return false;
  await setFulfilment(order.id, "DELIVERY", address);
  return true;
}

/**
 * Collection or delivery means they are wrapping up, so the menu step can be
 * skipped. Naming more food keeps the menu open for the next tap.
 */
async function applySharedToBasket(
  order: FullOrder,
  catalog: DictationItem[],
  shared: { groupId: string; optionName: string },
): Promise<boolean> {
  let changed = false;
  for (const item of order.items) {
    if (item.modifiers.some((modifier) => modifier.groupId === shared.groupId)) continue;
    const entry = catalog.find((candidate) => candidate.id === item.menuItemId);
    const option = entry?.options.find(
      (candidate) => candidate.groupId === shared.groupId && normaliseMenuText(candidate.name) === normaliseMenuText(shared.optionName),
    );
    if (!option) continue;
    if (option.scope === "MEAL_ONLY" && item.isMeal !== true) continue;
    await setModifierSelection(order.id, item.id, option.groupId, [option.id]);
    changed = true;
  }
  return changed;
}

async function noteAdding(conversationId: string, orderId: string, parsed: ParsedUtterance) {
  if (!parsed.fulfilment) {
    if (parsed.lines.length) {
      await db.conversation.update({ where: { id: conversationId }, data: { askedAnythingElse: false } });
    }
    return;
  }
  const order = await loadOrder(orderId);
  if (order.items.length && !nextRequirement(order)) {
    await db.conversation.update({ where: { id: conversationId }, data: { askedAnythingElse: true } });
  }
}

const ORDER_REQUEST = /\b(get|order|want|like|have|need|take|grab|buy|make me)\b/;

function isQuestionWithoutItem(raw: string, catalog: DictationItem[]): boolean {
  const text = normalise(raw);
  if (!QUESTION.test(text)) return false;
  if (itemHits(normaliseMenuText(raw), raw, catalog).length > 0) return false;
  // "can I get a coke?" is an order even though Coke is a flavour, not a menu row.
  if (ORDER_REQUEST.test(text) && standaloneDrink(raw, catalog)) return false;
  return true;
}

function peelFulfilment(raw: string): { text: string; fulfilment: Fulfilment | null; deliveryAddress: string | null } {
  const delivery = raw.match(new RegExp(String.raw`\b(?:for\s+)?(?:${DELIVERY_WORD})\b([\s\S]*)$`, "i"));
  if (delivery && delivery.index !== undefined) {
    const before = raw.slice(0, delivery.index);
    const afterWord = delivery[1] ?? "";
    const addressed = afterWord.match(/^(.*?)(?:\b(?:to|at|@)\s+)([\s\S]+)$/i);
    if (addressed) {
      const between = addressed[1] ?? "";
      const cleaned = cleanAddress(addressed[2] ?? "");
      return {
        text: collapse(`${before} ${between}`),
        fulfilment: "DELIVERY",
        deliveryAddress: looksLikeAddress(cleaned) ? cleaned.slice(0, 240) : null,
      };
    }
    return { text: collapse(`${before} ${afterWord}`), fulfilment: "DELIVERY", deliveryAddress: null };
  }

  if (/\b(?:collect(?:ion)?|pick\s*-?\s*up|pickup|fetch)\b/i.test(raw)) {
    const text = raw.replace(/\b(?:for\s+)?(?:collect(?:ion)?|pick\s*-?\s*up|pickup|fetch)\b/gi, " ");
    return { text: collapse(text), fulfilment: "COLLECTION", deliveryAddress: null };
  }
  return { text: raw, fulfilment: null, deliveryAddress: null };
}

function cleanAddress(raw: string): string {
  return raw
    .replace(/\b(please|pls|thanks|thank you|dankie)\b\.?/gi, "")
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeAddress(value: string): boolean {
  if (value.length < 3) return false;
  const words = normalise(value);
  if (!words || /^(me|us|home|here|there|you|the shop)$/.test(words)) return false;
  if (/\d/.test(value)) return true;
  return /\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|close|crescent|way|place|court|flat|unit|house)\b/i.test(value);
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
}

/**
 * Turn pasted lists into comma clauses the splitter already understands.
 * Keeps "1/4 chicken" intact (no spaces around the slash) while splitting
 * "burger / chips" and newline lists so each line keeps its own quantity.
 */
function tidyOrderText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, ", ")
    .replace(/\s+\/\s+/g, ", ")
    .replace(/\b(\d{1,2})\s*[x×]\s*/gi, "$1 x ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",")
    .trim();
}

function splitClauses(raw: string, catalog: DictationItem[]): string[] {
  const parts = raw
    .split(/,|\b(?:\+|plus|also)\b|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const merged: string[] = [];
  for (const part of parts) {
    const prev = merged.at(-1);
    if (!prev) {
      merged.push(part);
      continue;
    }
    const prevHit = itemHits(normaliseMenuText(prev), prev, catalog)[0];
    const partHit = itemHits(normaliseMenuText(part), part, catalog)[0];
    const joined = `${prev} and ${part}`;
    const joinedHit = itemHits(normaliseMenuText(joined), joined, catalog)[0];
    const joinedLonger =
      joinedHit &&
      joinedHit.phrase.length > (prevHit?.phrase.length ?? 0) &&
      joinedHit.phrase.length > (partHit?.phrase.length ?? 0);
    if (joinedLonger && !(prevHit && partHit)) merged[merged.length - 1] = joined;
    else merged.push(part);
  }
  return merged.length ? merged : [raw.trim()].filter(Boolean);
}

function linesFromClause(clause: string, catalog: DictationItem[]): ParsedLine[] {
  const norm = normaliseMenuText(clause);
  const hits = itemHits(norm, clause, catalog);
  return hits.map((hit) => {
    const selections = matchOptions(norm, hit.item, [{ start: hit.index, end: hit.end }]);
    const isMeal = readMeal(clause, hit.item, selections);
    return {
      item: hit.item,
      quantity: readQuantityNear(clause, norm, hit.index),
      isMeal,
      selections,
      forceNew: ANOTHER.test(clause),
      notes: null,
    };
  });
}

interface ItemHit {
  item: DictationItem;
  phrase: string;
  index: number;
  end: number;
}

function itemHits(normalised: string, raw: string, catalog: DictationItem[]): ItemHit[] {
  const exact = collectItemHits(normalised, raw, catalog, false);
  const exactFood = exact.filter((hit) => !isDrinkVessel(hit.item));
  const fuzzy = collectItemHits(normalised, raw, catalog, true).filter((hit) => !isDrinkVessel(hit.item));
  const base = exactFood.length ? orderHits(exactFood) : fuzzy.length ? orderHits(fuzzy) : orderHits(exact);
  const fuller = preferFullerItem(normalised, base, catalog);
  if (fuller.length) return fuller;
  const unique = uniqueNameToken(normalised, catalog) ?? uniqueOptionItem(normalised, catalog);
  return unique ? [unique] : [];
}

/** "cappy" is the 330ml Cappy. A word that fits several dishes is left unmatched. */
function uniqueNameToken(normalised: string, catalog: DictationItem[]): ItemHit | null {
  const need = contentTokens(normalised);
  if (need.length !== 1) return null;
  const token = need[0];
  const hits = catalog.filter(
    (item) => !isDrinkVessel(item) && nameTokens(item).some((part) => part === token || tokensRoughlyEqual(part, token)),
  );
  if (hits.length !== 1) return null;
  const span = wordSpan(normalised, need);
  // Leave the word free so "appletiser" can also select the Appletiser option.
  return { item: hits[0], phrase: token, index: span.start, end: span.start };
}

/**
 * "jose" is the kids meal, not a dish with that name.
 * A word shared by several items, such as a spice, is left alone.
 */
function uniqueOptionItem(normalised: string, catalog: DictationItem[]): ItemHit | null {
  const need = contentTokens(normalised);
  if (need.length !== 1) return null;
  const token = need[0];
  const owners: { item: DictationItem; option: DictationOption }[] = [];
  for (const item of catalog) {
    if (isDrinkVessel(item)) continue;
    const matched = item.options.filter((option) =>
      normaliseMenuText(option.name)
        .split(" ")
        .some((part) => part.length >= 4 && (part === token || tokensRoughlyEqual(part, token))),
    );
    if (matched.length === 1) owners.push({ item, option: matched[0] });
  }
  if (owners.length !== 1) return null;
  const span = wordSpan(normalised, need);
  return { item: owners[0].item, phrase: token, index: span.start, end: span.start };
}

/**
 * "cheese burger" fits more than one burger. Name them instead of guessing.
 * A clear winner (Jalapeno Cheese Burger over the longer beef one) is not listed here.
 */
function closeMenuNames(clause: string, catalog: DictationItem[]): string[] {
  const need = normaliseMenuText(clause)
    .split(" ")
    .filter((token) => token.length >= 4 && token !== "meal" && token !== "combo" && token !== "please" && token !== "thanks");
  if (need.length < 2) return [];
  const scored = catalog
    .filter((item) => !isDrinkVessel(item) && coversTokens(need, nameTokens(item)))
    .map((item) => ({ item, precision: need.length / Math.max(1, nameTokens(item).length) }))
    .sort((a, b) => b.precision - a.precision || a.item.name.length - b.item.name.length);
  const best = scored[0];
  if (!best || best.precision < 0.45) return [];
  const close = scored.filter((row) => best.precision - row.precision < 0.12);
  if (close.length < 2) return [];
  return close.slice(0, 4).map((row) => row.item.name);
}

const ITEM_NOTE = /\b((?:with no|without|hold the|leave out|allergic to|allergy to|no)\s+.+)$/i;

/** "no tomato" is a leave-out, not a second menu item. "no meal" stays an answer to the meal question. */
function peelItemNote(clause: string): { food: string; note: string | null } {
  const match = clause.match(ITEM_NOTE);
  if (!match || match.index === undefined) return { food: clause, note: null };
  const note = match[1].replace(/^with\s+/i, "").replace(/\s+/g, " ").trim();
  const rest = note.replace(/^(?:no|without|hold the|leave out|allergic to|allergy to)\s+/i, "").trim();
  if (!rest || /^(a\s+)?meals?$/.test(normalise(rest)) || MEAL_NO.test(normalise(note))) {
    return { food: clause, note: null };
  }
  return { food: clause.slice(0, match.index).trim(), note };
}

function appendNote(current: string | null, extra: string): string {
  if (!current) return extra;
  if (current.toLowerCase().includes(extra.toLowerCase())) return current;
  return `${current}, ${extra}`.slice(0, 240);
}

function orderHits(hits: ItemHit[]): ItemHit[] {
  return [...hits].sort((a, b) => a.index - b.index);
}

function collectItemHits(normalised: string, raw: string, catalog: DictationItem[], fuzzy: boolean): ItemHit[] {
  const spans = fuzzy ? tokenSpans(normalised) : [];
  const hits: ItemHit[] = [];
  for (const item of catalog) {
    if (!itemAllowed(item, raw)) continue;
    let best: ItemHit | null = null;
    for (const phrase of itemPhrases(item)) {
      const found = fuzzy ? fuzzyPhraseSpan(spans, phrase) : exactPhraseSpan(normalised, phrase);
      if (!found) continue;
      if (!best || phrase.length > best.phrase.length) best = { item, phrase, index: found.start, end: found.end };
    }
    if (best) hits.push(best);
  }
  hits.sort((a, b) => b.phrase.length - a.phrase.length || a.index - b.index);
  const kept: ItemHit[] = [];
  for (const hit of hits) {
    if (kept.some((other) => rangesOverlap(other.index, other.end, hit.index, hit.end))) continue;
    kept.push(hit);
  }
  return kept;
}

function exactPhraseSpan(normalised: string, phrase: string): { start: number; end: number } | null {
  const index = indexOfPhrase(normalised, phrase);
  if (index < 0) return null;
  return { start: index, end: index + phrase.length };
}

function tokenSpans(normalised: string): { token: string; start: number; end: number }[] {
  const spans: { token: string; start: number; end: number }[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalised))) {
    spans.push({ token: match[0], start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/** A close spelling of the whole item name, in order, such as "burito" for Burrito. */
function fuzzyPhraseSpan(spans: { token: string; start: number; end: number }[], phrase: string): { start: number; end: number } | null {
  const parts = phrase.split(" ").filter(Boolean);
  if (!parts.length || spans.length < parts.length) return null;
  if (parts.length === 1 && parts[0].length < 4) return null;
  for (let i = 0; i <= spans.length - parts.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      if (!tokensRoughlyEqual(spans[i + j].token, parts[j])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    let adjacent = true;
    for (let j = 1; j < parts.length; j++) {
      if (spans[i + j].start - spans[i + j - 1].end > 1) {
        adjacent = false;
        break;
      }
    }
    if (!adjacent) continue;
    return { start: spans[i].start, end: spans[i + parts.length - 1].end };
  }
  return null;
}

function itemPhrases(item: DictationItem): string[] {
  const phrases = [normaliseMenuText(item.name)];
  if (item.shortName) phrases.push(normaliseMenuText(item.shortName));
  return [...new Set(phrases.filter((phrase) => phrase.length >= 3))];
}

function itemAllowed(item: DictationItem, raw: string): boolean {
  if (normaliseMenuText(item.name) !== "can") return true;
  return /\b(a can|the can|can of|cans)\b/i.test(raw);
}

function isDrinkVessel(item: DictationItem): boolean {
  const name = normaliseMenuText(item.name);
  return name === "can" || name === "buddy" || name === "1 5 litre";
}

function standaloneDrink(clause: string, catalog: DictationItem[]): ParsedLine | null {
  const vessels = catalog.filter(isDrinkVessel);
  const named = itemHits(normaliseMenuText(clause), clause, vessels)[0];
  const vessel = named?.item ?? vessels.find((item) => normaliseMenuText(item.name) === "can");
  if (!vessel) return null;
  const selections = matchOptions(normaliseMenuText(clause), vessel, []);
  if (!named && !selections.length) return null;
  return { item: vessel, quantity: readQuantity(clause), isMeal: false, selections, forceNew: ANOTHER.test(clause), notes: null };
}

function matchOptions(normalised: string, item: DictationItem, occupied: { start: number; end: number }[]): ParsedSelection[] {
  const hits: { option: DictationOption; index: number; end: number; phrase: string }[] = [];
  for (const option of item.options) {
    const phrase = normaliseMenuText(option.name);
    if (phrase.length < 3) continue;
    const index = indexOfPhrase(normalised, phrase);
    if (index < 0) continue;
    const end = index + phrase.length;
    if (occupied.some((span) => index >= span.start && end <= span.end)) continue;
    hits.push({ option, index, end, phrase });
  }
  hits.sort((a, b) => b.phrase.length - a.phrase.length || a.index - b.index);
  const taken = occupied.map((span) => ({ ...span }));
  const picked: typeof hits = [];
  for (const hit of hits) {
    if (taken.some((span) => rangesOverlap(span.start, span.end, hit.index, hit.end))) continue;
    if (hit.option.selection === "SINGLE" && picked.some((chosen) => chosen.option.groupId === hit.option.groupId)) continue;
    picked.push(hit);
    taken.push({ start: hit.index, end: hit.end });
  }

  const spans = tokenSpans(normalised).filter((span) => !taken.some((used) => rangesOverlap(used.start, used.end, span.start, span.end)));
  for (const option of item.options) {
    if (option.selection === "SINGLE" && picked.some((chosen) => chosen.option.groupId === option.groupId)) continue;
    const phrase = normaliseMenuText(option.name);
    if (phrase.length < 3) continue;
    const found = fuzzyPhraseSpan(spans, phrase);
    if (!found) continue;
    if (taken.some((span) => rangesOverlap(span.start, span.end, found.start, found.end))) continue;
    picked.push({ option, index: found.start, end: found.end, phrase });
    taken.push({ start: found.start, end: found.end });
    for (let i = spans.length - 1; i >= 0; i--) {
      if (rangesOverlap(spans[i].start, spans[i].end, found.start, found.end)) spans.splice(i, 1);
    }
  }

  // "freezo tofee" names the Toffee Caramel. One distinctive word is enough
  // when no other option in that group uses it.
  for (const span of [...spans]) {
    const owners = item.options.filter((option) => {
      if (option.selection === "SINGLE" && picked.some((chosen) => chosen.option.groupId === option.groupId)) return false;
      return normaliseMenuText(option.name)
        .split(" ")
        .some((part) => part.length >= 5 && (part === span.token || tokensRoughlyEqual(part, span.token)));
    });
    const unique = [...new Map(owners.map((option) => [option.id, option])).values()];
    if (unique.length !== 1) continue;
    const option = unique[0];
    picked.push({ option, index: span.start, end: span.end, phrase: span.token });
    for (let i = spans.length - 1; i >= 0; i--) {
      if (spans[i].start === span.start) spans.splice(i, 1);
    }
  }

  const byGroup = new Map<string, ParsedSelection>();
  for (const hit of picked) {
    const current = byGroup.get(hit.option.groupId) ?? {
      groupId: hit.option.groupId,
      optionIds: [],
      mealOnly: hit.option.scope === "MEAL_ONLY",
    };
    current.optionIds.push(hit.option.id);
    if (hit.option.scope === "MEAL_ONLY") current.mealOnly = true;
    byGroup.set(hit.option.groupId, current);
  }
  return [...byGroup.values()];
}

function mergeSelections(line: ParsedLine, extras: ParsedSelection[]) {
  for (const extra of extras) {
    const existing = line.selections.find((selection) => selection.groupId === extra.groupId);
    if (!existing) {
      line.selections.push(extra);
      continue;
    }
    if (extra.mealOnly) existing.mealOnly = true;
    for (const optionId of extra.optionIds) {
      if (!existing.optionIds.includes(optionId)) existing.optionIds.push(optionId);
    }
  }
}

function readMeal(raw: string, item: DictationItem, selections: ParsedSelection[]): boolean | null {
  if (!item.canBeMeal) return false;
  const text = normalise(raw);
  if (MEAL_NO.test(text)) return false;
  if (MEAL_YES.test(text) || selections.some((selection) => selection.mealOnly)) return true;
  return null;
}

function readQuantity(raw: string): number {
  const withoutFractions = raw.replace(/\d+\s*\/\s*\d+/g, " ").replace(/\b1\.5\b/g, " ");
  const times = withoutFractions.match(/\b(\d{1,2})\s*x\b/i);
  if (times) return clampQuantity(Number(times[1]));
  const digit = withoutFractions.match(/\b(\d{1,2})\b/);
  if (digit) return clampQuantity(Number(digit[1]));
  const word = normalise(raw).match(/\b(one|two|three|four|five|six)\b/);
  if (word) return NUMBER_WORDS[word[1]] ?? 1;
  return 1;
}

/** Prefer the "2 x" / "3" sitting just before this item when several share one clause. */
function readQuantityNear(raw: string, normalised: string, itemIndex: number): number {
  const before = normalised.slice(0, Math.max(0, itemIndex));
  const times = before.match(/(\d{1,2})\s*x\s*$/i);
  if (times) return clampQuantity(Number(times[1]));
  const digit = before.match(/(\d{1,2})\s*$/);
  if (digit) return clampQuantity(Number(digit[1]));
  return readQuantity(raw);
}

function clampQuantity(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(50, Math.floor(value));
}

function indexOfPhrase(haystack: string, phrase: string): number {
  const direct = indexOfWords(haystack, phrase);
  if (direct >= 0) return direct;
  const parts = phrase.split(" ");
  const last = parts.at(-1) ?? "";
  if (last.length > 3 && !last.endsWith("s")) {
    parts[parts.length - 1] = `${last}s`;
    return indexOfWords(haystack, parts.join(" "));
  }
  return -1;
}

function indexOfWords(haystack: string, phrase: string): number {
  if (!phrase) return -1;
  const padded = ` ${haystack} `;
  const at = padded.indexOf(` ${phrase} `);
  return at < 0 ? -1 : at;
}

function rangesOverlap(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && otherStart < end;
}
