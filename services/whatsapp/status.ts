import { decryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { ExternalServiceError, ValidationError } from "@/lib/errors";
import { audit } from "@/services/audit";
import { getBusiness } from "@/services/settings";
import { CloudApiWhatsAppService } from "@/services/whatsapp/cloud";
import { WhatsAppError } from "@/services/whatsapp/types";
import type { Actor } from "@/types/actor";

export interface IntegrationBlocker {
  code: "driver" | "phone" | "token" | "secret" | "verify" | "url" | "openai";
  message: string;
}

export interface IntegrationStatus {
  driver: string;
  webhookUrl: string;
  webhookPublic: boolean;
  appSecretConfigured: boolean;
  tokenConfigured: boolean;
  phoneNumberIdConfigured: boolean;
  openaiConfigured: boolean;
  openaiModel: string;
  /** Driver is cloud, creds present, webhook is publicly reachable, signatures + OpenAI configured. */
  liveReady: boolean;
  blockers: IntegrationBlocker[];
}

/** Meta only delivers webhooks to a public HTTPS URL — never localhost or plain HTTP. */
function isPublicHttps(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) return false;
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export function getIntegrationStatus(business: {
  whatsappPhoneNumberId: string | null;
  whatsappAccessTokenEnc: string | null;
}): IntegrationStatus {
  const appUrl = env.appUrl.replace(/\/$/, "") || "http://localhost:3000";
  const webhookUrl = `${appUrl}/api/webhooks/whatsapp`;
  const webhookPublic = isPublicHttps(appUrl);
  const tokenConfigured = !!(business.whatsappAccessTokenEnc || env.whatsappAccessToken);
  const phoneNumberIdConfigured = !!business.whatsappPhoneNumberId;
  const appSecretConfigured = !!env.whatsappAppSecret;
  const verifyConfigured = !!env.whatsappVerifyToken && env.whatsappVerifyToken !== "change-me";
  const openaiConfigured = !!env.openaiApiKey;
  const driver = env.whatsappDriver === "mock" ? "mock" : "cloud";

  const blockers: IntegrationBlocker[] = [];
  if (driver !== "cloud") {
    blockers.push({
      code: "driver",
      message: 'Set WHATSAPP_DRIVER="cloud" in .env and restart the app so messages go through Meta instead of the local mock.',
    });
  }
  if (!phoneNumberIdConfigured) {
    blockers.push({ code: "phone", message: "Paste the WhatsApp Phone number ID from Meta into Settings and save." });
  }
  if (!tokenConfigured) {
    blockers.push({ code: "token", message: "Paste a permanent WhatsApp access token in Settings (or set WHATSAPP_ACCESS_TOKEN in .env)." });
  }
  if (!appSecretConfigured) {
    blockers.push({
      code: "secret",
      message: "Set WHATSAPP_APP_SECRET in .env to your Meta App secret so inbound webhooks are verified.",
    });
  }
  if (!verifyConfigured) {
    blockers.push({
      code: "verify",
      message: "Set WHATSAPP_VERIFY_TOKEN in .env to a long random string and paste the same value in Meta webhook settings.",
    });
  }
  if (!webhookPublic) {
    blockers.push({
      code: "url",
      message:
        "APP_URL must be a public https:// address. Meta cannot deliver messages to localhost or plain HTTP — deploy the app or put a tunnel (ngrok / Cloudflare Tunnel) in front and set APP_URL to that URL.",
    });
  }
  if (!openaiConfigured) {
    blockers.push({
      code: "openai",
      message: "Set OPENAI_API_KEY in .env so the assistant can reply on WhatsApp. Without it, inbound chats are flagged for a human.",
    });
  }

  return {
    driver,
    webhookUrl,
    webhookPublic,
    appSecretConfigured,
    tokenConfigured,
    phoneNumberIdConfigured,
    openaiConfigured,
    openaiModel: env.openaiModel,
    liveReady: blockers.length === 0,
    blockers,
  };
}

export async function testWhatsAppConnection(
  actor: Actor,
  input: { phoneNumberId?: string; accessToken?: string } = {},
) {
  const business = await getBusiness(actor.businessId);
  const phoneNumberId = input.phoneNumberId?.trim() || business.whatsappPhoneNumberId || "";
  let accessToken = input.accessToken?.trim() || "";
  if (!accessToken && business.whatsappAccessTokenEnc) {
    try {
      accessToken = decryptSecret(business.whatsappAccessTokenEnc);
    } catch {
      accessToken = "";
    }
  }
  if (!accessToken) accessToken = env.whatsappAccessToken;
  if (!phoneNumberId) throw new ValidationError("Save a WhatsApp Phone number ID first");
  if (!accessToken) throw new ValidationError("Save a WhatsApp access token first");

  try {
    const profile = await new CloudApiWhatsAppService().verifyPhoneNumber({ phoneNumberId, accessToken });
    await audit(actor, {
      action: "whatsapp.test",
      entityType: "Business",
      entityId: actor.businessId,
      summary: `WhatsApp Graph API OK${profile.verifiedName ? ` (${profile.verifiedName})` : ""}${profile.displayPhoneNumber ? ` ${profile.displayPhoneNumber}` : ""}`,
    });
    return { ok: true as const, profile };
  } catch (e) {
    if (e instanceof WhatsAppError) throw new ExternalServiceError(e.message);
    throw e;
  }
}
