import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { writeKitchenSession } from "@/lib/session";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  if (!/^\d{4,8}$/.test(pin)) {
    return Response.json({ error: "Enter the kitchen PIN." }, { status: 400 });
  }

  const store = await db.store.findFirst({ orderBy: { createdAt: "asc" } });
  if (!store?.kitchenPinHash) {
    return Response.json({ error: "The kitchen is not set up yet. Seed the database first." }, { status: 503 });
  }

  const ok = await bcrypt.compare(pin, store.kitchenPinHash);
  if (!ok) return Response.json({ error: "That PIN is not right." }, { status: 401 });

  await writeKitchenSession(store.id);
  return Response.json({ ok: true, storeName: store.tradingName || store.name });
}
