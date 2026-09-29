import { route } from "@/lib/api";
import { retryFailedMessage } from "@/services/conversations";

export const POST = route<{ id: string; mid: string }>(async ({ session, params }) => retryFailedMessage(session.actor, params.id, params.mid));
