import { isGreeting, normalise } from "@/services/conversations/understanding";
import { spellingClose } from "@/services/menu/matching";

export interface FaqMatchInput {
  question: string;
  answer: string;
  keywords: string[];
}

const QUESTION =
  /^(do|does|did|can|could|what|whats|where|wheres|when|how|is|are|wat|waar|wanneer|hoe|why|which)\b|\?/;

/** A customer asking something, including a short "u deliver?". An order does not count. */
export function isShopQuestion(raw: string): boolean {
  const text = normalise(raw);
  return Boolean(text) && QUESTION.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The keyword's real words, in order, allowing a typo on each one.
 * "do you delivar" hits "deliver". "where is my order" does not hit "where are you".
 */
function keywordWindow(words: string[], keywordWords: string[]): boolean {
  const keys = keywordWords.filter((word) => word.length >= 3);
  if (!keys.length) return false;
  let start = 0;
  for (let index = 0; index < keys.length; index++) {
    const limit = index === 0 ? words.length : Math.min(words.length, start + 3);
    let found = -1;
    for (let i = start; i < limit; i++) {
      if (words[i] === keys[index] || spellingClose(words[i], keys[index])) {
        found = i;
        break;
      }
    }
    if (found < 0) return false;
    start = found + 1;
  }
  return true;
}

/**
 * Pick the staff-written answer that fits this message.
 * A question can match a short keyword ("where"). A statement has to hit a
 * longer phrase, so "hot quarter chicken" is an order and not the heat FAQ.
 */
export function matchFaq<T extends FaqMatchInput>(raw: string, faqs: T[]): T | null {
  const text = normalise(raw);
  if (!text || isGreeting(raw)) return null;

  const question = QUESTION.test(text);
  let best: { faq: T; score: number; longest: number } | null = null;

  for (const faq of faqs) {
    let score = 0;
    let longest = 0;
    const words = text.split(" ").filter(Boolean);
    for (const keyword of faq.keywords) {
      const normalised = normalise(keyword);
      if (normalised.length < 3) continue;
      const exact = new RegExp(`\\b${escapeRegExp(normalised)}\\b`).test(text);
      const fuzzy = !exact && keywordWindow(words, normalised.split(" ").filter(Boolean));
      if (!exact && !fuzzy) continue;
      const weight = exact ? normalised.length : normalised.length - 0.5;
      score += weight;
      longest = Math.max(longest, normalised.length);
    }
    if (score > 0 && (!best || score > best.score || (score === best.score && longest > best.longest))) {
      best = { faq, score, longest };
    }
  }

  if (!best) return null;
  if (question && best.score >= 4) return best.faq;
  if (best.longest >= 10) return best.faq;
  return null;
}
