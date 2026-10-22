import { db } from "@/lib/db";
import { readKitchenSession } from "@/lib/session";

const HISTORY_STATUSES = ["COLLECTED", "CANCELLED", "REJECTED"] as const;
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
      status: { in: [...HISTORY_STATUSES] },
      confirmedAt: { not: null, gte: since },
    },
    orderBy: [{ collectedAt: "desc" }, { confirmedAt: "desc" }],
    include: {
      customer: true,
      items: { orderBy: { sortOrder: "asc" }, include: { modifiers: { orderBy: { id: "asc" } } } },
    },
  });

  const collected = orders.filter((o) => o.status === "COLLECTED");
  const summary = {
    orderCount: orders.length,
    collectedCount: collected.length,
    cancelledCount: orders.filter((o) => o.status === "CANCELLED" || o.status === "REJECTED").length,
    collectedTotalCents: collected.reduce((sum, o) => sum + o.totalCents, 0),
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
      cancelledAt: order.cancelledAt,
      cancelReason: order.cancelReason,
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
