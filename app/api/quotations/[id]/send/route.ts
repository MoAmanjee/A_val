import { route } from "@/lib/api";
import { sendQuotation } from "@/services/quotes/service";

/** Retry a failed send, or resend an already sent quotation. */
export const POST = route<{ id: string }>(async ({ session, params }) => sendQuotation(session.actor, params.id));
