/**
 * "No" on its own means the item can be made as it is.
 * "No tomato" and "no lettuce" are the note.
 */
export function isSkippedItemNote(raw: string): boolean {
  const text = raw.trim();
  if (!text) return true;
  return /^(no|nope|nah|nee|none|nothing|no notes?|no allergy|no allergies|all good|its fine|it's fine)(?:\s+(?:please|pls|thanks|thank you|dankie))?$/i.test(
    text,
  );
}
