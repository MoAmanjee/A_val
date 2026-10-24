import { db } from "@/lib/db";
import { readOpsSession } from "@/lib/session";
import { listOpsStores } from "@/services/ops/tenant";
import { buildPayfastUpdate, payfastStatus } from "@/services/payments/payfast";
import type { BillingStatus } from "@prisma/client";

export async function GET() {
  if (!(await readOpsSession())) {
    return Response.json({ error: "Sign in with the ops PIN." }, { status: 401 });
  }
  try {
    const stores = await listOpsStores();
    return Response.json({ stores });
  } catch (e) {
    console.error("[ops] list stores failed", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not load stores." },
      { status: 500 },
    );
  }
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
    payfastMerchantId?: unknown;
    payfastMerchantKey?: unknown;
    payfastPassphrase?: unknown;
    payfastMode?: unknown;
    payfastEnabled?: unknown;
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
    payfastMerchantId?: string | null;
    payfastMerchantKeyEnc?: string | null;
    payfastPassphraseEnc?: string | null;
    payfastMode?: string;
    payfastEnabled?: boolean;
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

  const payfastPatch = buildPayfastUpdate({
    merchantId: typeof body?.payfastMerchantId === "string" || body?.payfastMerchantId === null ? (body.payfastMerchantId as string | null) : undefined,
    merchantKey: typeof body?.payfastMerchantKey === "string" || body?.payfastMerchantKey === null ? (body.payfastMerchantKey as string | null) : undefined,
    passphrase: typeof body?.payfastPassphrase === "string" || body?.payfastPassphrase === null ? (body.payfastPassphrase as string | null) : undefined,
    mode: typeof body?.payfastMode === "string" ? body.payfastMode : undefined,
    enabled: typeof body?.payfastEnabled === "boolean" ? body.payfastEnabled : undefined,
  });
  Object.assign(data, payfastPatch);

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
      payfast: payfastStatus(store),
    },
  });
}
