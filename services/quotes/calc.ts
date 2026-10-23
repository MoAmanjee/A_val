import { fromCents, toCents } from "@/utils/money";
import { ValidationError } from "@/lib/errors";

/**
 * Pure, server-side quote arithmetic. Totals from the client are never trusted:
 * everything is recomputed from quantity, unit price, discount and VAT rate.
 *
 * Conventions
 *  - `total` of a line is its price basis: quantity x unit price - discount.
 *  - pricesIncludeVat = false: VAT is added on top of the line total.
 *  - pricesIncludeVat = true : line totals already contain VAT; VAT is extracted.
 *  - Quote total = subtotal + labour - discount (+ VAT when exclusive).
 *    Subtotal/labour/discount are on the same VAT basis as the entered prices.
 */

export interface LineInput {
  quantity: number;
  unitPrice: number;
  discount?: number;
  vatRate: number;
}

export interface LineResult {
  gross: string;
  discount: string;
  total: string;
  vat: string;
  vatRate: string;
  /** Amount payable for the line (total, plus VAT when prices exclude VAT). */
  payable: string;
}

export interface QuoteTotals {
  subtotal: string;
  labourTotal: string;
  discount: string;
  vat: string;
  total: string;
}

export interface CalcResult {
  items: LineResult[];
  labour: LineResult[];
  totals: QuoteTotals;
}

function assertFinite(n: number, label: string) {
  if (!Number.isFinite(n)) throw new ValidationError(`${label} must be a number`);
}

interface LineCents {
  grossC: number;
  discountC: number;
  baseC: number;
  vatC: number;
  payableC: number;
  rate: number;
}

function calcLineCents(line: LineInput, pricesIncludeVat: boolean, label: string): LineCents {
  assertFinite(line.quantity, `${label} quantity`);
  assertFinite(line.unitPrice, `${label} unit price`);
  assertFinite(line.vatRate, `${label} VAT rate`);
  if (line.quantity <= 0) throw new ValidationError(`${label}: quantity must be greater than 0`);
  if (line.unitPrice < 0) throw new ValidationError(`${label}: price cannot be negative`);
  if (line.vatRate < 0 || line.vatRate > 100) throw new ValidationError(`${label}: VAT rate must be between 0 and 100`);
  const discount = line.discount ?? 0;
  assertFinite(discount, `${label} discount`);
  if (discount < 0) throw new ValidationError(`${label}: discount cannot be negative`);

  const grossC = Math.round(line.quantity * toCents(line.unitPrice));
  const discountC = toCents(discount);
  if (discountC > grossC) throw new ValidationError(`${label}: discount cannot exceed the line amount`);
  const baseC = grossC - discountC;
  const rateBp = Math.round(line.vatRate * 100);
  const vatC = pricesIncludeVat
    ? baseC - Math.round((baseC * 10000) / (10000 + rateBp))
    : Math.round((baseC * rateBp) / 10000);
  return {
    grossC,
    discountC,
    baseC,
    vatC,
    payableC: pricesIncludeVat ? baseC : baseC + vatC,
    rate: line.vatRate,
  };
}

function toLineResult(c: LineCents): LineResult {
  return {
    gross: fromCents(c.grossC),
    discount: fromCents(c.discountC),
    total: fromCents(c.baseC),
    vat: fromCents(c.vatC),
    vatRate: c.rate.toFixed(2),
    payable: fromCents(c.payableC),
  };
}

export function calculateQuote(input: {
  items: LineInput[];
  labour: (Omit<LineInput, "quantity"> & { hours: number })[];
  pricesIncludeVat: boolean;
}): CalcResult {
  const { pricesIncludeVat } = input;
  const itemC = input.items.map((l, i) => calcLineCents(l, pricesIncludeVat, `Part line ${i + 1}`));
  const labourC = input.labour.map((l, i) =>
    calcLineCents({ quantity: l.hours, unitPrice: l.unitPrice, discount: l.discount, vatRate: l.vatRate }, pricesIncludeVat, `Labour line ${i + 1}`),
  );

  const subtotalC = itemC.reduce((s, c) => s + c.grossC, 0);
  const labourTotalC = labourC.reduce((s, c) => s + c.grossC, 0);
  const discountC = [...itemC, ...labourC].reduce((s, c) => s + c.discountC, 0);
  const vatC = [...itemC, ...labourC].reduce((s, c) => s + c.vatC, 0);
  const totalC = subtotalC + labourTotalC - discountC + (pricesIncludeVat ? 0 : vatC);

  return {
    items: itemC.map(toLineResult),
    labour: labourC.map(toLineResult),
    totals: {
      subtotal: fromCents(subtotalC),
      labourTotal: fromCents(labourTotalC),
      discount: fromCents(discountC),
      vat: fromCents(vatC),
      total: fromCents(totalC),
    },
  };
}
