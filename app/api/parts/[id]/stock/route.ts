import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { adjustStock } from "@/services/inventory";

export const POST = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(
    req,
    z.object({ delta: z.coerce.number().int().optional(), set: z.coerce.number().int().min(0).optional(), reason: z.string().max(200).optional() }),
  );
  return { part: await adjustStock(session.actor, params.id, body) };
});
