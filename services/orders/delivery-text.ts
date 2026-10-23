/**
 * A delivery reply is an address, plus an optional note for the driver.
 * The note can sit on the next line, or after "note:".
 */
export function parseDeliveryText(raw: string): { address: string; notes: string | null } | null {
  const text = raw.trim();
  if (text.length < 5 || text.length > 500) return null;
  if (/^(do|does|can|could|what|where|when|how|is|are|wat|waar|wanneer|hoe)\b/i.test(text)) return null;

  let address = text;
  let notes: string | null = null;
  const marked = text.match(/^([\s\S]+?)(?:\n+|\s+)(?:delivery\s+)?notes?\s*:\s*([\s\S]+)$/i);
  if (marked) {
    address = marked[1].trim();
    notes = marked[2].trim();
  } else if (text.includes("\n")) {
    const [first, ...rest] = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    address = first ?? "";
    notes = rest.join(" ").trim() || null;
  }

  address = address.replace(/[.,\s]+$/g, "").trim();
  if (address.length < 5 || address.length > 240) return null;
  if (notes) notes = notes.slice(0, 240);
  return { address, notes };
}

/** "No", "no note", "skip" and "nothing" mean there is no driver note. A longer line is the note. */
export function isSkippedDriverNote(raw: string): boolean {
  const text = raw.trim();
  if (!text) return true;
  if (/^(no|nope|nah|nee|no note|none|skip|nothing|no thanks)(?:\s+(?:please|pls|thanks|thank you|dankie))?$/i.test(text)) {
    return true;
  }
  return false;
}

export function pinLabel(loc: { latitude: number; longitude: number; name?: string; address?: string }): string {
  const named = [loc.name, loc.address].map((part) => part?.trim()).filter(Boolean).join(", ");
  if (named) return named.slice(0, 240);
  return `Pinned location (${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)})`;
}
