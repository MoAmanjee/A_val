import { LEAN_ORDERING } from "@/services/orders/features";
import type { FullOrder, FullOrderItem, ItemModifierLink } from "@/services/orders/query";

/**
 * Works out what an order still needs before it can be confirmed.
 *
 * This is deliberately derived from the basket rather than tracked as a
 * conversation state machine: whatever route the customer took to get here
 * (typing a full order in one message, tapping through the menu, or changing
 * their mind), the next question is always "what is still unanswered?".
 *
 * Within one item the order is: the always-asked choices (basting), then the
 * meal upgrade, then the choices that only exist inside a meal (side, drink),
 * then an optional leave-out or allergy (unless LEAN_ORDERING asks one note
 * for the whole order at the end). Items are completed one at a time.
 */

export type Requirement =
  | { kind: "MODIFIER"; item: FullOrderItem; link: ItemModifierLink }
  | { kind: "MEAL_UPGRADE"; item: FullOrderItem }
  | { kind: "ITEM_NOTES"; item: FullOrderItem };

function hasSelection(item: FullOrderItem, groupId: string): boolean {
  return item.modifiers.some((m) => m.groupId === groupId);
}

/** A group with nothing in stock cannot be asked, so it is not a blocker. */
function askable(link: ItemModifierLink): boolean {
  return link.group.options.some((o) => o.available);
}

function requirementsForItem(item: FullOrderItem): Requirement[] {
  const out: Requirement[] = [];
  const links = item.menuItem.modifierLinks;

  for (const link of links) {
    if (link.scope !== "ALWAYS" || !link.required) continue;
    if (!hasSelection(item, link.modifierGroupId) && askable(link)) out.push({ kind: "MODIFIER", item, link });
  }

  if (item.isMeal === null) {
    out.push({ kind: "MEAL_UPGRADE", item });
    // The side and drink questions only make sense once we know it is a meal.
    return out;
  }

  if (item.isMeal) {
    for (const link of links) {
      if (link.scope !== "MEAL_ONLY" || !link.required) continue;
      if (!hasSelection(item, link.modifierGroupId) && askable(link)) out.push({ kind: "MODIFIER", item, link });
    }
  }

  // Lean mode asks one kitchen note for the whole order at checkout instead.
  if (!LEAN_ORDERING && out.length === 0 && !item.notesOffered && !item.notes?.trim()) {
    out.push({ kind: "ITEM_NOTES", item });
  }
  return out;
}

/** True once the end-of-order kitchen note has been offered (or every item was asked the old way). */
export function orderNotesDone(order: FullOrder): boolean {
  if (!order.items.length) return true;
  if (LEAN_ORDERING) return order.items.every((item) => item.notesOffered);
  return order.items.every((item) => item.notesOffered || Boolean(item.notes?.trim()));
}

export function missingRequirements(order: FullOrder): Requirement[] {
  return order.items.flatMap(requirementsForItem);
}

export function nextRequirement(order: FullOrder): Requirement | null {
  for (const item of order.items) {
    const [first] = requirementsForItem(item);
    if (first) return first;
  }
  return null;
}

export function isReadyToConfirm(order: FullOrder): boolean {
  return order.items.length > 0 && nextRequirement(order) === null;
}

/**
 * Optional groups the customer has not been offered yet (extras, toppings).
 * The agent may mention these, but they never block confirmation.
 */
export function optionalGroups(item: FullOrderItem): ItemModifierLink[] {
  return item.menuItem.modifierLinks.filter(
    (l) =>
      !l.required &&
      askable(l) &&
      (l.scope === "ALWAYS" || item.isMeal === true) &&
      !hasSelection(item, l.modifierGroupId),
  );
}
