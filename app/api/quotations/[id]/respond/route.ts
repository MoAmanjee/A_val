import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { respondToQuotation } from "@/services/quotes/service";

/** Record the customer's decision. A future customer-facing accept/decline link can reuse respondToQuotation. */
export const POST = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(req, z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]) }));
  return { quotation: await respondToQuotation(session.actor, params.id, body.decision) };
});
