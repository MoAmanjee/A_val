import { describe, expect, it } from "vitest";
import { calculateQuote } from "@/services/quotes/calc";
import { formatMoney, fromCents, toCents } from "@/utils/money";

describe("money helpers", () => {
  it("converts with no float drift", () => {
    expect(toCents(1.15)).toBe(115);
    expect(toCents("4082.50")).toBe(408250);
    expect(fromCents(408250)).toBe("4082.50");
    expect(fromCents(5)).toBe("0.05");
  });
  it("formats currency", () => {
    expect(formatMoney(4082.5, "R")).toBe("R4,082.50");
    expect(formatMoney(1234567.891, "$")).toBe("$1,234,567.89");
  });
});

describe("quote calculation", () => {
  const item = (o: Partial<{ quantity: number; unitPrice: number; discount: number; vatRate: number }> = {}) => ({ quantity: 1, unitPrice: 100, discount: 0, vatRate: 15, ...o });

  it("adds VAT on top when prices exclude VAT (spec example: 3,550 + 15% = 4,082.50)", () => {
    const r = calculateQuote({
      items: [item({ unitPrice: 750 }), item({ quantity: 2, unitPrice: 1200 })],
      labour: [{ hours: 1, unitPrice: 400, vatRate: 15 }],
      pricesIncludeVat: false,
    });
    expect(r.totals).toEqual({ subtotal: "3150.00", labourTotal: "400.00", discount: "0.00", vat: "532.50", total: "4082.50" });
  });

  it("calculates quantity x unit price per line", () => {
    const r = calculateQuote({ items: [item({ quantity: 2, unitPrice: 1400 })], labour: [], pricesIncludeVat: false });
    expect(r.items[0].total).toBe("2800.00");
    expect(r.totals.total).toBe("3220.00");
  });

  it("applies line discounts before VAT", () => {
    const r = calculateQuote({ items: [item({ unitPrice: 750, discount: 50 })], labour: [], pricesIncludeVat: false });
    expect(r.items[0].total).toBe("700.00");
    expect(r.items[0].vat).toBe("105.00");
    expect(r.totals).toMatchObject({ subtotal: "750.00", discount: "50.00", vat: "105.00", total: "805.00" });
  });

  it("extracts VAT when prices already include it", () => {
    const r = calculateQuote({ items: [item({ unitPrice: 115 })], labour: [{ hours: 1, unitPrice: 230, vatRate: 15 }], pricesIncludeVat: true });
    expect(r.totals.total).toBe("345.00");
    expect(r.totals.vat).toBe("45.00");
  });

  it("supports zero-rated lines and configurable VAT rates (not hard-coded to 15%)", () => {
    const zero = calculateQuote({ items: [item({ vatRate: 0 })], labour: [], pricesIncludeVat: false });
    expect(zero.totals).toMatchObject({ vat: "0.00", total: "100.00" });
    const twenty = calculateQuote({ items: [item({ vatRate: 20 })], labour: [], pricesIncludeVat: false });
    expect(twenty.totals).toMatchObject({ vat: "20.00", total: "120.00" });
    const mixed = calculateQuote({ items: [item({ vatRate: 5 }), item({ vatRate: 20 })], labour: [], pricesIncludeVat: false });
    expect(mixed.totals.vat).toBe("25.00");
  });

  it("multiplies labour hours by rate", () => {
    const r = calculateQuote({ items: [], labour: [{ hours: 2.5, unitPrice: 480, vatRate: 15 }], pricesIncludeVat: false });
    expect(r.labour[0].total).toBe("1200.00");
    expect(r.totals).toMatchObject({ labourTotal: "1200.00", vat: "180.00", total: "1380.00" });
  });

  it("rounds VAT per line to the nearest cent", () => {
    const r = calculateQuote({ items: [item({ unitPrice: 0.33, quantity: 3 })], labour: [], pricesIncludeVat: false });
    expect(r.items[0].vat).toBe("0.15");
  });

  it("rejects invalid input", () => {
    expect(() => calculateQuote({ items: [item({ quantity: 0 })], labour: [], pricesIncludeVat: false })).toThrow(/quantity/);
    expect(() => calculateQuote({ items: [item({ unitPrice: -1 })], labour: [], pricesIncludeVat: false })).toThrow(/negative/);
    expect(() => calculateQuote({ items: [item({ discount: 500 })], labour: [], pricesIncludeVat: false })).toThrow(/discount/);
    expect(() => calculateQuote({ items: [item({ vatRate: 150 })], labour: [], pricesIncludeVat: false })).toThrow(/VAT/);
    expect(() => calculateQuote({ items: [item({ unitPrice: NaN })], labour: [], pricesIncludeVat: false })).toThrow();
  });

  it("returns zeros for an empty quote", () => {
    expect(calculateQuote({ items: [], labour: [], pricesIncludeVat: false }).totals.total).toBe("0.00");
  });
});
