import type { FaqMatchInput } from "@/services/conversations/faq";
import type { LLMClient } from "@/services/ai/llm";

/**
 * Open questions go to the model with the staff-written answers as the only
 * source. Prices, delivery areas and allergen lists are not in that pack, so
 * the model is told to refuse them instead of inventing them.
 */

export type FaqLlmResult = { kind: "answer"; text: string } | { kind: "unknown" } | { kind: "order" };

export function buildFaqSystemPrompt(faqs: FaqMatchInput[]): string {
  const packed = faqs.map((faq) => `Q: ${faq.question}\nA: ${faq.answer}`).join("\n\n");
  return [
    "You answer WhatsApp questions for Mochachos Potchefstroom CBD, a flame-grilled chicken takeaway in South Africa.",
    "Customers misspell words and write the way they speak. Read the question with the spelling corrected. delivar means deliver, alergy means allergy, chiken means chicken, ours means hours.",
    "Answer in one or two short sentences, the way someone behind the counter would. No headings, no bullet lists, no markdown. Match Afrikaans if they write in Afrikaans.",
    "Use only the staff answers below. If the question is not covered by them, reply with exactly UNKNOWN.",
    "If they are naming food they want to buy, reply with exactly ORDER.",
    "Do not invent a price, a delivery fee, a delivery area, an allergen list, or opening hours that are not written below.",
    "Delivery is off. Orders are collection from the shop, paid at the till.",
    "If they ask whether the food is halaal, reply with exactly UNKNOWN.",
    "",
    "Staff answers:",
    packed,
  ].join("\n");
}

export function interpretFaqReply(raw: string | null): FaqLlmResult {
  const text = (raw ?? "").trim();
  if (!text || /^unknown\b/i.test(text)) return { kind: "unknown" };
  if (/^order\b/i.test(text)) return { kind: "order" };
  return { kind: "answer", text: text.slice(0, 700) };
}

export async function answerFaqWithLlm(llm: LLMClient, question: string, faqs: FaqMatchInput[]): Promise<FaqLlmResult> {
  const res = await llm.complete({
    system: buildFaqSystemPrompt(faqs),
    messages: [{ role: "user", content: question.trim().slice(0, 500) }],
    tools: [],
  });
  return interpretFaqReply(res.content);
}
