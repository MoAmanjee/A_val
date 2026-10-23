import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { cancelQuotation } from "@/services/quotes/service";

export const POST = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(req, z.object({ reason: z.string().max(300).optional() })).catch(() => ({ reason: undefined }));
  return { quotation: await cancelQuotation(session.actor, params.id, body.reason) };
});
