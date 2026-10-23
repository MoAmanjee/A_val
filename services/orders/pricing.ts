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

/** Shop delivery prices stay inside a range a till can actually charge. */
export const DELIVERY_FEE_STEP_CENTS = 500;
export const DELIVERY_FEE_MAX_CENTS = 20_000;

export function clampDeliveryFeeCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.max(0, Math.min(DELIVERY_FEE_MAX_CENTS, Math.round(cents)));
}

export function orderTotals(lines: LineInput[], deliveryFeeCents = 0): OrderTotals {
  const subtotalCents = lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const fee = clampDeliveryFeeCents(deliveryFeeCents);
  return { subtotalCents, totalCents: subtotalCents + fee };
}
