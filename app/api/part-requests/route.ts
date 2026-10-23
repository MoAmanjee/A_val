import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { pageQuery } from "@/lib/validation";
import { listPartRequests } from "@/services/inventory/requests";

export const GET = route(async ({ req, session }) => {
  const q = parseQuery(req, z.object({ status: z.enum(["ACTIVE", "OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"]).optional(), ...pageQuery }));
  return listPartRequests(session.businessId, q);
});
