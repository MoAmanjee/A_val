import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { resumeAi, setConversationStatus, takeOver } from "@/services/conversations";

export const POST = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(req, z.object({ action: z.enum(["take_over", "resume_ai", "close", "complete", "reopen"]) }));
  switch (body.action) {
    case "take_over":
      return { conversation: await takeOver(session.actor, params.id) };
    case "resume_ai":
      return { conversation: await resumeAi(session.actor, params.id) };
    case "close":
      return { conversation: await setConversationStatus(session.actor, params.id, "CLOSED") };
    case "complete":
      return { conversation: await setConversationStatus(session.actor, params.id, "COMPLETED") };
    case "reopen":
      return { conversation: await setConversationStatus(session.actor, params.id, "ACTIVE") };
  }
});
