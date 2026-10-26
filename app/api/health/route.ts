import { db } from "@/lib/db";
import { syncStoreWhatsAppPhoneFromEnv } from "@/services/whatsapp/sync-store";

/**
 * Uptime / load-balancer probe. Does not require auth.
 * Returns 200 when the database answers; 503 when it does not.
 */
export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const waSync = await syncStoreWhatsAppPhoneFromEnv().catch(() => ({ updated: false, phoneNumberId: null }));
    const stores = await db.store.count();
    return Response.json({
      ok: true,
      dbMs: Date.now() - started,
      stores,
      whatsappPhoneSynced: waSync.updated,
      time: new Date().toISOString(),
    });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "database unavailable",
        time: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
