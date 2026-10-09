import { db } from "@/lib/db";
import { readKitchenSession } from "@/lib/session";
import { setStoreDeliveryFee } from "@/services/orders/cart";
import { DELIVERY_FEE_MAX_CENTS, clampDeliveryFeeCents } from "@/services/orders/pricing";

export async function POST(req: Request) {
  const session = await readKitchenSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });

  const store = await db.store.findUnique({ where: { id: session.storeId } });
  if (!store) return Response.json({ error: "Sign in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { free?: unknown; deltaCents?: unknown; deliveryFeeCents?: unknown } | null;
  let next = store.deliveryFeeCents;
  if (body?.free === true) next = 0;
  else if (typeof body?.deltaCents === "number") next = store.deliveryFeeCents + body.deltaCents;
  else if (typeof body?.deliveryFeeCents === "number") next = body.deliveryFeeCents;
  else return Response.json({ error: "Say how the delivery price should change." }, { status: 400 });

  const deliveryFeeCents = await setStoreDeliveryFee(store.id, clampDeliveryFeeCents(next));
  return Response.json({ deliveryFeeCents, maxCents: DELIVERY_FEE_MAX_CENTS });
}
