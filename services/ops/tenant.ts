import type { BillingStatus, Store } from "@prisma/client";
import { db } from "@/lib/db";

export type TenantChannel = "whatsapp" | "web";

export interface TenantGate {
  ok: boolean;
  /** Short reason for logs / customer copy. */
  reason: string | null;
}

/** True when the business is cut off for non-payment. */
export function isBillingSuspended(store: Pick<Store, "billingStatus">): boolean {
  return store.billingStatus === "SUSPENDED";
}

/**
 * Can this store take new traffic on a channel?
 * Kitchen pause (acceptingOrders) is separate — that is the shop pausing, not you cutting them.
 */
export function tenantGate(
  store: Pick<Store, "billingStatus" | "whatsappEnabled" | "webEnabled" | "acceptingOrders" | "pausedReason" | "suspendedReason">,
  channel: TenantChannel,
): TenantGate {
  if (store.billingStatus === "SUSPENDED") {
    return {
      ok: false,
      reason: store.suspendedReason?.trim() || "This ordering service is suspended. Please contact support.",
    };
  }
  if (channel === "whatsapp" && !store.whatsappEnabled) {
    return { ok: false, reason: store.suspendedReason?.trim() || "WhatsApp ordering is switched off for this branch." };
  }
  if (channel === "web" && !store.webEnabled) {
    return { ok: false, reason: store.suspendedReason?.trim() || "Online ordering is switched off for this branch." };
  }
  if (!store.acceptingOrders) {
    return { ok: false, reason: store.pausedReason?.trim() || "The kitchen has paused new orders for a moment." };
  }
  return { ok: true, reason: null };
}

/** Calendar day key as YYYY-MM-DD in the store timezone (best-effort UTC date for metering). */
function usageDayKey(now = new Date()): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return new Date(Date.UTC(y, m, d));
}

export async function recordMessageUsage(
  storeId: string,
  direction: "INBOUND" | "OUTBOUND",
  opts?: { failed?: boolean },
): Promise<void> {
  const day = usageDayKey();
  const inbound = direction === "INBOUND" ? 1 : 0;
  const outbound = direction === "OUTBOUND" ? 1 : 0;
  const failed = opts?.failed ? 1 : 0;
  await db.storeUsageDay.upsert({
    where: { storeId_day: { storeId, day } },
    create: {
      storeId,
      day,
      inboundCount: inbound,
      outboundCount: outbound,
      failedCount: failed,
    },
    update: {
      inboundCount: { increment: inbound },
      outboundCount: { increment: outbound },
      failedCount: { increment: failed },
    },
  });
}

export interface StoreUsageSummary {
  inbound24h: number;
  outbound24h: number;
  failed24h: number;
  inbound7d: number;
  outbound7d: number;
  outboundMonth: number;
  cap: number | null;
  overCap: boolean;
}

export async function storeUsageSummary(
  storeId: string,
  monthlyMessageCap: number | null,
): Promise<StoreUsageSummary> {
  const now = new Date();
  const day = usageDayKey(now);
  const sevenAgo = new Date(day);
  sevenAgo.setUTCDate(sevenAgo.getUTCDate() - 6);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const rows = await db.storeUsageDay.findMany({
    where: { storeId, day: { gte: sevenAgo } },
    orderBy: { day: "desc" },
  });

  const today = rows.find((row) => row.day.getTime() === day.getTime());
  const inbound24h = today?.inboundCount ?? 0;
  const outbound24h = today?.outboundCount ?? 0;
  const failed24h = today?.failedCount ?? 0;
  const inbound7d = rows.reduce((sum, row) => sum + row.inboundCount, 0);
  const outbound7d = rows.reduce((sum, row) => sum + row.outboundCount, 0);

  const monthRows = await db.storeUsageDay.findMany({
    where: { storeId, day: { gte: monthStart } },
    select: { outboundCount: true },
  });
  const outboundMonth = monthRows.reduce((sum, row) => sum + row.outboundCount, 0);
  const cap = monthlyMessageCap;
  const overCap = cap != null && outboundMonth >= cap;

  return { inbound24h, outbound24h, failed24h, inbound7d, outbound7d, outboundMonth, cap, overCap };
}

export type HealthLevel = "healthy" | "warn" | "down";

export interface StoreHealth {
  level: HealthLevel;
  label: string;
  detail: string;
}

export function storeHealth(input: {
  billingStatus: BillingStatus;
  whatsappEnabled: boolean;
  webEnabled: boolean;
  acceptingOrders: boolean;
  whatsappLive: boolean;
  usage: StoreUsageSummary;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
}): StoreHealth {
  if (input.billingStatus === "SUSPENDED") {
    return { level: "down", label: "Suspended", detail: "Cut off for billing — WhatsApp and web blocked." };
  }
  if (!input.whatsappEnabled && !input.webEnabled) {
    return { level: "down", label: "Channels off", detail: "Both WhatsApp and web are switched off." };
  }
  if (!input.whatsappLive && input.whatsappEnabled) {
    return { level: "warn", label: "WhatsApp not live", detail: "Token or phone number id missing / mock driver." };
  }
  if (input.billingStatus === "PAST_DUE") {
    return { level: "warn", label: "Past due", detail: "Payment overdue — still online until you suspend." };
  }
  if (input.usage.overCap) {
    return { level: "warn", label: "Over message cap", detail: `Outbound this month ${input.usage.outboundMonth} ≥ cap ${input.usage.cap}.` };
  }
  if (!input.acceptingOrders) {
    return { level: "warn", label: "Kitchen paused", detail: "Shop paused new orders; channels still reachable." };
  }
  const staleMs = 36 * 60 * 60 * 1000;
  const recent = input.lastOutboundAt && Date.now() - input.lastOutboundAt.getTime() < staleMs;
  if (!recent && input.usage.outbound7d === 0) {
    return { level: "warn", label: "Quiet", detail: "No outbound WhatsApp in the last 7 days." };
  }
  return { level: "healthy", label: "Healthy", detail: "Billing active, channels on, WhatsApp reachable." };
}

export async function listOpsStores() {
  const stores = await db.store.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      tradingName: true,
      slug: true,
      variant: true,
      city: true,
      billingStatus: true,
      whatsappEnabled: true,
      webEnabled: true,
      acceptingOrders: true,
      pausedReason: true,
      suspendedReason: true,
      monthlyMessageCap: true,
      whatsappPhoneNumberId: true,
      whatsappAccessTokenEnc: true,
      updatedAt: true,
    },
  });

  const results = [];
  for (const store of stores) {
    const usage = await storeUsageSummary(store.id, store.monthlyMessageCap);
    const lastConv = await db.conversation.findFirst({
      where: { storeId: store.id },
      orderBy: [{ lastOutboundAt: "desc" }, { lastInboundAt: "desc" }],
      select: { lastOutboundAt: true, lastInboundAt: true },
    });
    const { describeWhatsApp } = await import("@/services/promotions/broadcast");
    const wa = describeWhatsApp({
      whatsappPhoneNumberId: store.whatsappPhoneNumberId,
      whatsappAccessTokenEnc: store.whatsappAccessTokenEnc,
    });
    const health = storeHealth({
      billingStatus: store.billingStatus,
      whatsappEnabled: store.whatsappEnabled,
      webEnabled: store.webEnabled,
      acceptingOrders: store.acceptingOrders,
      whatsappLive: wa.live,
      usage,
      lastOutboundAt: lastConv?.lastOutboundAt ?? null,
      lastInboundAt: lastConv?.lastInboundAt ?? null,
    });
    results.push({
      ...store,
      usage,
      health,
      whatsapp: wa,
    });
  }
  return results;
}
