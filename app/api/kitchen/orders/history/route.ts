import { db } from "@/lib/db";
import { readKitchenSession } from "@/lib/session";

/** Kitchen History is completed slips only — collected orders from the last 7 days. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
  const session = await readKitchenSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });

  const store = await db.store.findUnique({ where: { id: session.storeId } });
  if (!store) return Response.json({ error: "Sign in" }, { status: 401 });

  const since = new Date(Date.now() - WEEK_MS);

  const orders = await db.order.findMany({
    where: {
      storeId: store.id,
      status: "COLLECTED",
      confirmedAt: { not: null, gte: since },
    },
    orderBy: [{ collectedAt: "desc" }, { confirmedAt: "desc" }],
    include: {
      customer: true,
      items: { orderBy: { sortOrder: "asc" }, include: { modifiers: { orderBy: { id: "asc" } } } },
    },
  });

  const summary = {
    orderCount: orders.length,
    collectedCount: orders.length,
    collectedTotalCents: orders.reduce((sum, o) => sum + o.totalCents, 0),
  };

  return Response.json({
    store: {
      name: store.tradingName || store.name,
      currencySymbol: store.currencySymbol,
    },
    since: since.toISOString(),
    summary,
    orders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalCents: order.totalCents,
      notes: order.notes,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      fulfilment: order.fulfilment,
      deliveryAddress: order.deliveryAddress,
      deliveryFeeCents: order.deliveryFeeCents,
      confirmedAt: order.confirmedAt,
      acknowledgedAt: order.acknowledgedAt,
      readyAt: order.readyAt,
      collectedAt: order.collectedAt,
      customerName: order.customer.name || order.customer.whatsappProfileName || order.customer.phone,
      items: order.items.map((item) => ({
        id: item.id,
        name: item.nameSnapshot,
        quantity: item.quantity,
        notes: item.notes,
        isMeal: item.isMeal,
        modifiers: item.modifiers.map((m) => m.optionNameSnapshot),
      })),
    })),
  });
}
