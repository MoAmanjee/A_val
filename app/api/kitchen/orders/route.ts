import { db } from "@/lib/db";
import { readKitchenSession } from "@/lib/session";

const OPEN = ["SENT_TO_KITCHEN", "ACKNOWLEDGED", "PREPARING", "READY_FOR_COLLECTION"] as const;

export async function GET() {
  const session = await readKitchenSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });

  const store = await db.store.findUnique({ where: { id: session.storeId } });
  if (!store) return Response.json({ error: "Sign in" }, { status: 401 });

  const orders = await db.order.findMany({
    where: { storeId: store.id, status: { in: [...OPEN] } },
    orderBy: { confirmedAt: "asc" },
    include: {
      customer: true,
      items: { orderBy: { sortOrder: "asc" }, include: { modifiers: { orderBy: { id: "asc" } } } },
    },
  });

  return Response.json({
    store: {
      name: store.tradingName || store.name,
      defaultPrepMinutes: store.defaultPrepMinutes,
      currencySymbol: store.currencySymbol,
      deliveryFeeCents: store.deliveryFeeCents,
    },
    orders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalCents: order.totalCents,
      notes: order.notes,
      fulfilment: order.fulfilment,
      deliveryAddress: order.deliveryAddress,
      deliveryNotes: order.deliveryNotes,
      deliveryLatitude: order.deliveryLatitude,
      deliveryLongitude: order.deliveryLongitude,
      deliveryFeeCents: order.deliveryFeeCents,
      confirmedAt: order.confirmedAt,
      promisedReadyAt: order.promisedReadyAt,
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
