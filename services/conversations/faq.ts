import { isGreeting, normalise } from "@/services/conversations/understanding";

export interface FaqMatchInput {
  question: string;
  answer: string;
  keywords: string[];
}

const QUESTION =
  /^(do|does|can|could|what|whats|where|wheres|when|how|is|are|wat|waar|wanneer|hoe)\b|\?/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    for (const keyword of faq.keywords) {
      const normalised = normalise(keyword);
      if (normalised.length < 3) continue;
      if (!new RegExp(`\\b${escapeRegExp(normalised)}\\b`).test(text)) continue;
      score += normalised.length;
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
