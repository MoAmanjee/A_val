/**
 * Order arithmetic, kept free of Prisma so it can be reasoned about and tested
 * on its own. Everything is in integer cents.
 *
 * A line is priced as: (item price + meal upgrade + every chosen modifier)
 * multiplied by the quantity. South African menu prices are VAT inclusive, so
 * there is no tax line to add on top.
 */

export interface LineInput {
  unitPriceCents: number;
  quantity: number;
  /** null means the customer has not been asked about a meal upgrade yet. */
  isMeal: boolean | null;
  mealUpgradeCents: number;
  modifierDeltaCents: number[];
}

export function lineTotalCents(line: LineInput): number {
  const meal = line.isMeal ? line.mealUpgradeCents : 0;
  const modifiers = line.modifierDeltaCents.reduce((sum, d) => sum + d, 0);
  const each = line.unitPriceCents + meal + modifiers;
  return each * Math.max(1, line.quantity);
}

export interface OrderTotals {
  subtotalCents: number;
  totalCents: number;
}

export function orderTotals(lines: LineInput[]): OrderTotals {
  const subtotalCents = lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
  // Kept separate from the subtotal so discounts or a collection fee can be
  // introduced later without rewriting every caller.
  return { subtotalCents, totalCents: subtotalCents };
}
