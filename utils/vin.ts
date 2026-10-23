export interface VinValidation {
  valid: boolean;
  vin: string;
  reason?: string;
}

/** Strip whitespace/dashes and upper-case. */
export function normalizeVin(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Structural VIN validation (ISO 3779): 17 characters, alphanumeric, no I/O/Q.
 * The position-9 check digit is intentionally NOT enforced: it is only mandated
 * in North America, and many valid European/Asian VINs fail it.
 */
export function validateVin(input: string): VinValidation {
  const vin = normalizeVin(input);
  if (vin.length !== 17) {
    return { valid: false, vin, reason: `A VIN has 17 characters (this one has ${vin.length}).` };
  }
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    return { valid: false, vin, reason: "A VIN only contains letters and numbers, and never the letters I, O or Q." };
  }
  return { valid: true, vin };
}

/** Try to find a VIN inside free text. */
export function extractVinFromText(text: string): string | null {
  const candidates = text.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g);
  if (!candidates) return null;
  for (const c of candidates) {
    if (/[A-Z]/.test(c) && /\d/.test(c)) return c;
  }
  return null;
}
