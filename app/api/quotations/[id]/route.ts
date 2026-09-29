import { parseJson, route } from "@/lib/api";
import { quoteBody } from "@/lib/schemas";
import { getQuotationFull, updateQuotation } from "@/services/quotes/service";

export const GET = route<{ id: string }>(async ({ session, params }) => ({ quotation: await getQuotationFull(session.businessId, params.id) }));

/** Totals in the body are ignored on purpose: the server always recomputes them from the lines. */
export const PUT = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(req, quoteBody.partial());
  return { quotation: await updateQuotation(session.actor, params.id, body) };
});
