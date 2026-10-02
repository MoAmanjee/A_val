import { createHmac } from "node:crypto";
import type { Business } from "@prisma/client";
import { decryptSecret, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { CloudApiWhatsAppService } from "@/services/whatsapp/cloud";
import { MockWhatsAppService } from "@/services/whatsapp/mock";
import { WhatsAppError, type WhatsAppCredentials, type WhatsAppService } from "@/services/whatsapp/types";

export * from "@/services/whatsapp/types";
export { MockWhatsAppService } from "@/services/whatsapp/mock";
export { CloudApiWhatsAppService, parseWhatsAppWebhook } from "@/services/whatsapp/cloud";
export { getIntegrationStatus, testWhatsAppConnection } from "@/services/whatsapp/status";

let instance: WhatsAppService | null = null;

export function getWhatsAppService(): WhatsAppService {
  if (instance) return instance;
  instance = env.whatsappDriver === "mock" ? new MockWhatsAppService() : new CloudApiWhatsAppService();
  return instance;
}

export function setWhatsAppService(s: WhatsAppService | null) {
  instance = s;
}

/** Per-business credentials, falling back to the platform-level token. */
export function getCredentials(business: Pick<Business, "whatsappPhoneNumberId" | "whatsappAccessTokenEnc">): WhatsAppCredentials {
  let token = env.whatsappAccessToken;
  if (business.whatsappAccessTokenEnc) {
    try {
      token = decryptSecret(business.whatsappAccessTokenEnc);
    } catch {
      throw new WhatsAppError("Stored WhatsApp access token could not be decrypted. Re-enter it in Settings.", false);
    }
  }
  const phoneNumberId = business.whatsappPhoneNumberId ?? "";
  if (env.whatsappDriver !== "mock") {
    if (!phoneNumberId) throw new WhatsAppError("WhatsApp is not connected: set the WhatsApp phone number ID in Settings.", false);
    if (!token) throw new WhatsAppError("WhatsApp is not connected: no access token configured.", false);
  }
  return { phoneNumberId, accessToken: token };
}

/** Verify Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret = env.whatsappAppSecret): boolean {
  if (!secret) return false;
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(header.slice("sha256=".length), expected);
}
