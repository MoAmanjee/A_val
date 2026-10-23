import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { sendBusinessReply } from "@/services/conversations";

/** Staff reply. Taking over pauses the AI for this conversation. */
export const POST = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(req, z.object({ text: z.string().trim().min(1).max(4000) }));
  return sendBusinessReply(session.actor, params.id, body.text);
});
