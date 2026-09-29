import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { pageQuery } from "@/lib/validation";
import { listAuditLogs } from "@/services/audit";

export const GET = route(async ({ req, session }) => {
  const q = parseQuery(req, z.object({ entityType: z.string().optional(), entityId: z.string().optional(), action: z.string().optional(), ...pageQuery }));
  return listAuditLogs(session.businessId, q);
});
