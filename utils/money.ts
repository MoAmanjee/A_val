/**
 * Money helpers. All arithmetic is done in integer minor units (cents) to avoid
 * floating point drift; values are only converted back to decimals at the edge.
 */

type Numeric = number | string | { toString(): string } | null | undefined;

export function toNumber(v: Numeric): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

export function toCents(v: Numeric): number {
  return Math.round(toNumber(v) * 100);
}

/** Returns a fixed 2dp decimal string suitable for Prisma Decimal columns. */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

export function formatMoney(v: Numeric, symbol = "R"): string {
  const n = toNumber(v);
  const fixed = Math.abs(n).toFixed(2);
  const [whole, frac] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}${symbol}${grouped}.${frac}`;
}
