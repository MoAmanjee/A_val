import { route } from "@/lib/api";
import { getConversation } from "@/services/conversations";

export const GET = route<{ id: string }>(async ({ session, params }) => ({
  conversation: await getConversation(session.businessId, params.id, { markRead: true }),
}));
