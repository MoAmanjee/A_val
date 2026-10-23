import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { pageQuery } from "@/lib/validation";
import { listConversations } from "@/services/conversations";

export const GET = route(async ({ req, session }) => {
  const q = parseQuery(
    req,
    z.object({
      q: z.string().optional(),
      status: z.enum(["OPEN", "ACTIVE", "WAITING_FOR_CUSTOMER", "QUOTE_PENDING", "QUOTE_APPROVAL", "HUMAN_REQUIRED", "COMPLETED", "CLOSED"]).optional(),
      ...pageQuery,
    }),
  );
  return listConversations(session.businessId, q);
});
