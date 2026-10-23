import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { approveQuotation } from "@/services/quotes/service";

/** APPROVE & SEND. Pass { send: false } to approve and generate the PDF without sending yet. */
export const POST = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(req, z.object({ send: z.boolean().optional() })).catch(() => ({ send: undefined }));
  return approveQuotation(session.actor, params.id, { send: body.send });
});
