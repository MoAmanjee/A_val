import { db } from "@/lib/db";
import { env } from "@/lib/env";

const PLACEHOLDER_PHONE_ID = "100000000000001";

/**
 * Keep the one shop row's WhatsApp phone number id in sync with the environment.
 * Inbound Meta webhooks are routed by that column, so a token-only env update is
 * not enough for live testing.
 */
export async function syncStoreWhatsAppPhoneFromEnv(): Promise<{ updated: boolean; phoneNumberId: string | null }> {
  const fromEnv = env.whatsappPhoneNumberId?.trim() || "";
  if (!fromEnv || fromEnv === PLACEHOLDER_PHONE_ID) {
    return { updated: false, phoneNumberId: fromEnv || null };
  }

  const store = await db.store.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, whatsappPhoneNumberId: true } });
  if (!store) return { updated: false, phoneNumberId: fromEnv };
  if (store.whatsappPhoneNumberId === fromEnv) {
    return { updated: false, phoneNumberId: fromEnv };
  }

  await db.store.update({
    where: { id: store.id },
    data: { whatsappPhoneNumberId: fromEnv },
  });
  return { updated: true, phoneNumberId: fromEnv };
}
