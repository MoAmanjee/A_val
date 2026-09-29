import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { updatePartRequest } from "@/services/inventory/requests";

export const PUT = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(req, z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"]).optional(), notes: z.string().max(1000).nullish() }));
  return { partRequest: await updatePartRequest(session.actor, params.id, body) };
});
