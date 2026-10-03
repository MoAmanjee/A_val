/**
 * Every price in this app is stored and calculated as an integer number of
 * cents, so there is no floating point drift in an order total. Values are only
 * turned into decimal strings at the edge (WhatsApp messages, kitchen screen).
 */
export function formatCents(cents: number, symbol = "R"): string {
  const n = Math.round(cents);
  const abs = Math.abs(n);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const frac = String(abs % 100).padStart(2, "0");
  return `${n < 0 ? "-" : ""}${symbol}${whole}.${frac}`;
}

/** Parses "89.90", "R89,90" or "8990c" style input into cents. */
export function parsePriceToCents(input: string | number): number {
  if (typeof input === "number") return Math.round(input * 100);
  const cleaned = input.trim().replace(/[Rr\s]/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error(`"${input}" is not a valid price`);
  return Math.round(n * 100);
}
