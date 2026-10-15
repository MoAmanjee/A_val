import { db } from "@/lib/db";
import { readOpsSession } from "@/lib/session";
import { listOpsStores } from "@/services/ops/tenant";
import type { BillingStatus } from "@prisma/client";

export async function GET() {
  if (!(await readOpsSession())) {
    return Response.json({ error: "Sign in with the ops PIN." }, { status: 401 });
  }
  const stores = await listOpsStores();
  return Response.json({ stores });
}

export async function PATCH(req: Request) {
  if (!(await readOpsSession())) {
    return Response.json({ error: "Sign in with the ops PIN." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    storeId?: unknown;
    billingStatus?: unknown;
    whatsappEnabled?: unknown;
    webEnabled?: unknown;
    acceptingOrders?: unknown;
    suspendedReason?: unknown;
    pausedReason?: unknown;
    monthlyMessageCap?: unknown;
  } | null;

  const storeId = typeof body?.storeId === "string" ? body.storeId : "";
  if (!storeId) return Response.json({ error: "storeId is required." }, { status: 400 });

  const data: {
    billingStatus?: BillingStatus;
    whatsappEnabled?: boolean;
    webEnabled?: boolean;
    acceptingOrders?: boolean;
    suspendedReason?: string | null;
    pausedReason?: string | null;
    monthlyMessageCap?: number | null;
  } = {};

  if (body?.billingStatus === "ACTIVE" || body?.billingStatus === "PAST_DUE" || body?.billingStatus === "SUSPENDED") {
    data.billingStatus = body.billingStatus;
  }
  if (typeof body?.whatsappEnabled === "boolean") data.whatsappEnabled = body.whatsappEnabled;
  if (typeof body?.webEnabled === "boolean") data.webEnabled = body.webEnabled;
  if (typeof body?.acceptingOrders === "boolean") data.acceptingOrders = body.acceptingOrders;
  if (typeof body?.suspendedReason === "string" || body?.suspendedReason === null) {
    data.suspendedReason = typeof body.suspendedReason === "string" ? body.suspendedReason.trim().slice(0, 240) || null : null;
  }
  if (typeof body?.pausedReason === "string" || body?.pausedReason === null) {
    data.pausedReason = typeof body.pausedReason === "string" ? body.pausedReason.trim().slice(0, 240) || null : null;
  }
  if (body?.monthlyMessageCap === null) data.monthlyMessageCap = null;
  else if (typeof body?.monthlyMessageCap === "number" && Number.isFinite(body.monthlyMessageCap)) {
    data.monthlyMessageCap = Math.max(0, Math.floor(body.monthlyMessageCap));
  }

  if (!Object.keys(data).length) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const store = await db.store.update({ where: { id: storeId }, data });
  return Response.json({
    ok: true,
    store: {
      id: store.id,
      billingStatus: store.billingStatus,
      whatsappEnabled: store.whatsappEnabled,
      webEnabled: store.webEnabled,
      acceptingOrders: store.acceptingOrders,
      suspendedReason: store.suspendedReason,
      pausedReason: store.pausedReason,
      monthlyMessageCap: store.monthlyMessageCap,
    },
  });
}
