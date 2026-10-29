import { db } from "@/lib/db";
import { readKitchenSession } from "@/lib/session";
import {
  dayWindowJohannesburg,
  johannesburgDateKey,
  weekDayKeysJohannesburg,
  weekWindowJohannesburg,
} from "@/utils/time";

/**
 * Kitchen History is completed slips only — collected orders in the current
 * Africa/Johannesburg calendar week (Monday 00:00 → next Monday 00:00).
 * Older weeks are soft-hidden from the default view (orders stay in the DB).
 * Optional `?day=YYYY-MM-DD` narrows to one day inside that week.
 */
export async function GET(req: Request) {
  const session = await readKitchenSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });

  const store = await db.store.findUnique({ where: { id: session.storeId } });
  if (!store) return Response.json({ error: "Sign in" }, { status: 401 });

  const week = weekWindowJohannesburg();
  const dayKeys = weekDayKeysJohannesburg();
  const todayKey = johannesburgDateKey();

  const dayParam = new URL(req.url).searchParams.get("day")?.trim() || null;
  let rangeStart = week.startsAt;
  let rangeEnd = week.endsAt;
  let dayFilter: string | null = null;

  if (dayParam) {
    if (!dayKeys.includes(dayParam)) {
      return Response.json(
        { error: "Pick a day in this week (Monday–Sunday, Johannesburg time)." },
        { status: 400 },
      );
    }
    const day = dayWindowJohannesburg(dayParam);
    rangeStart = day.startsAt;
    rangeEnd = day.endsAt;
    dayFilter = dayParam;
  }

  const orders = await db.order.findMany({
    where: {
      storeId: store.id,
      status: "COLLECTED",
      collectedAt: { not: null, gte: rangeStart, lt: rangeEnd },
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

  const weekLabel = new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Johannesburg",
  }).format(week.startsAt);

  return Response.json({
    store: {
      name: store.tradingName || store.name,
      currencySymbol: store.currencySymbol,
    },
    /** @deprecated Prefer weekStartsAt — kept for older clients. */
    since: week.startsAt.toISOString(),
    weekStartsAt: week.startsAt.toISOString(),
    weekEndsAt: week.endsAt.toISOString(),
    weekLabel: `Week of ${weekLabel}`,
    weekResetsOn: "Monday 00:00 Africa/Johannesburg",
    todayKey,
    day: dayFilter,
    days: dayKeys.map((key) => {
      const noon = new Date(`${key}T12:00:00.000+02:00`);
      return {
        key,
        weekday: new Intl.DateTimeFormat("en-ZA", {
          weekday: "short",
          timeZone: "Africa/Johannesburg",
        }).format(noon),
        dayNum: new Intl.DateTimeFormat("en-ZA", {
          day: "numeric",
          timeZone: "Africa/Johannesburg",
        }).format(noon),
        isToday: key === todayKey,
        isFuture: key > todayKey,
      };
    }),
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
      dayKey: order.collectedAt ? johannesburgDateKey(order.collectedAt) : null,
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
