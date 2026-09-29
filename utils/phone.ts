/**
 * WhatsApp identifies users by their number in international format without a
 * leading "+" (e.g. 27821234567). We store numbers in that canonical form.
 */
export function normalizePhone(input: string): string {
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

export function formatPhoneDisplay(phone: string): string {
  const p = normalizePhone(phone);
  return p ? `+${p}` : "";
}
