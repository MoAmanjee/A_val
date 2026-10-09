/**
 * WhatsApp identifies users by their number in international format without a
 * leading "+" (e.g. 27821234567). We store numbers in that canonical form.
 * South African customers usually type 082..., so a leading 0 is swapped for 27.
 */
export function normalizePhone(input: string): string {
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) digits = `27${digits.slice(1)}`;
  return digits;
}

export function formatPhoneDisplay(phone: string): string {
  const p = normalizePhone(phone);
  return p ? `+${p}` : "";
}

/** "Thabo Mokoena" -> "Thabo". Used to greet the customer by first name. */
export function firstName(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  return first.length > 1 ? first : trimmed;
}
