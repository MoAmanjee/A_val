import type { Fulfilment } from "@prisma/client";
import { db } from "@/lib/db";
import { normalise } from "@/services/conversations/understanding";
import { normaliseMenuText } from "@/services/menu/matching";
import type { MenuSeed } from "@/db/menu";
import { addItem, findDraft, getOrCreateDraft, loadOrder, setFulfilment, setMealUpgrade, setModifierSelection, setQuantity } from "@/services/orders/cart";
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
}

export interface ParsedUtterance {
  lines: ParsedLine[];
  fulfilment: Fulfilment | null;
  deliveryAddress: string | null;
  /** A question such as "do you deliver?" with no item in it. Not an order. */
  ignoredAsQuestion: boolean;
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
  const empty: ParsedUtterance = { lines: [], fulfilment: null, deliveryAddress: null, ignoredAsQuestion: false };
  const trimmed = raw.trim();
  if (!trimmed) return empty;
  if (isQuestionWithoutItem(trimmed, catalog)) return { ...empty, ignoredAsQuestion: true };

  const peeled = peelFulfilment(trimmed);
  const clauses = splitClauses(peeled.text, catalog);
  const lines: ParsedLine[] = [];

  for (const clause of clauses) {
    const built = linesFromClause(clause, catalog);
    if (built.length) {
      lines.push(...built);
      continue;
    }
    const previous = lines.at(-1);
    if (!previous) {
      const drink = standaloneDrink(clause, catalog);
      if (drink) lines.push(drink);
      continue;
    }
    const extras = choicesForItem(clause, previous.item);
    if (extras.isMeal === true) previous.isMeal = true;
    else if (extras.isMeal === false && previous.isMeal === null) previous.isMeal = false;
    mergeSelections(previous, extras.selections);
  }

  const shared = sharedChoice(trimmed, catalog);
  if (shared) {
    for (const line of lines) applySharedToLine(line, shared);
  }

  return { lines, fulfilment: peeled.fulfilment, deliveryAddress: peeled.deliveryAddress, ignoredAsQuestion: false };
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

export async function applyDictation(conversationId: string, text: string): Promise<{ changed: boolean }> {
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const catalog = await loadCatalog(conv.storeId);
  const parsed = parseUtterance(text, catalog);
  if (parsed.ignoredAsQuestion) return { changed: false };

  const existing = await findDraft(conversationId);
  const namesAFood = parsed.lines.some((line) => !isDrinkVessel(line.item));
  const shared = sharedChoice(text, catalog);
  if (shared && existing?.items.length && !namesAFood) {
    const spread = await applySharedToBasket(existing, catalog, shared);
    if (spread) {
      const current = await loadOrder(existing.id);
      await writeFulfilment(current, parsed);
      await noteAdding(conversationId, existing.id, parsed);
      return { changed: true };
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
        });
        const current = await loadOrder(existing.id);
        if (await writeFulfilment(current, parsed)) changed = true;
        if (changed) await noteAdding(conversationId, existing.id, parsed);
        return { changed };
      }
    }
  }

  if (!parsed.lines.length && !parsed.fulfilment) {
    if (!existing?.items.length) return { changed: false };
    const target = pickLooseTarget(existing, catalog, text);
    if (!target) return { changed: false };
    const item = catalog.find((entry) => entry.id === target.menuItemId);
    if (!item) return { changed: false };
    const extras = choicesForItem(text, item);
    if (!extras.selections.length && extras.isMeal === null) return { changed: false };
    const changed = await writeOnto(existing.id, target, {
      item,
      quantity: target.quantity,
      isMeal: extras.isMeal,
      selections: extras.selections,
      forceNew: false,
    });
    if (changed) await noteAdding(conversationId, existing.id, parsed);
    return { changed };
  }

  if (!parsed.lines.length) {
    if (!existing) return { changed: false };
    const changed = await writeFulfilment(existing, parsed);
    if (changed) await noteAdding(conversationId, existing.id, parsed);
    return { changed };
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
  return { changed };
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
    const selections = matchOptions(norm, hit.item, [{ start: hit.index, end: hit.index + hit.phrase.length }]);
    const isMeal = readMeal(clause, hit.item, selections);
    return {
      item: hit.item,
      quantity: readQuantity(clause),
      isMeal,
      selections,
      forceNew: ANOTHER.test(clause),
    };
  });
}

interface ItemHit {
  item: DictationItem;
  phrase: string;
  index: number;
}

function itemHits(normalised: string, raw: string, catalog: DictationItem[]): ItemHit[] {
  const hits: ItemHit[] = [];
  for (const item of catalog) {
    if (!itemAllowed(item, raw)) continue;
    let best: ItemHit | null = null;
    for (const phrase of itemPhrases(item)) {
      const index = indexOfPhrase(normalised, phrase);
      if (index < 0) continue;
      if (!best || phrase.length > best.phrase.length) best = { item, phrase, index };
    }
    if (best) hits.push(best);
  }
  hits.sort((a, b) => b.phrase.length - a.phrase.length || a.index - b.index);
  const kept: ItemHit[] = [];
  for (const hit of hits) {
    const end = hit.index + hit.phrase.length;
    if (kept.some((other) => rangesOverlap(other.index, other.index + other.phrase.length, hit.index, end))) continue;
    kept.push(hit);
  }
  const food = kept.filter((hit) => !isDrinkVessel(hit.item));
  const chosen = food.length ? food : kept;
  chosen.sort((a, b) => a.index - b.index);
  return chosen;
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
  return { item: vessel, quantity: readQuantity(clause), isMeal: false, selections, forceNew: ANOTHER.test(clause) };
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
  const withoutFractions = raw.replace(/\d+\s*\/\s*\d+/g, " ");
  const digit = withoutFractions.match(/\b(\d{1,2})\b/);
  if (digit) return clampQuantity(Number(digit[1]));
  const word = normalise(raw).match(/\b(one|two|three|four|five|six)\b/);
  if (word) return NUMBER_WORDS[word[1]] ?? 1;
  return 1;
}

function clampQuantity(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(20, Math.floor(value));
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
