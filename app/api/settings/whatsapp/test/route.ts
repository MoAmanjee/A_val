import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { testWhatsAppConnection } from "@/services/whatsapp/status";

const body = z.object({
  phoneNumberId: z.string().min(1).max(60).optional(),
  accessToken: z.string().min(1).max(1000).optional(),
});

/** Hits Meta Graph API with the saved (or just-typed) token. Never sends a customer message. */
export const POST = route(
  async ({ req, session }) => {
    const input = await parseJson(req, body);
    return testWhatsAppConnection(session.actor, input);
  },
  { roles: ["BUSINESS_ADMIN"] },
);
