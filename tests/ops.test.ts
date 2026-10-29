import { describe, expect, it } from "vitest";
import { storeHealth, tenantGate, type StoreUsageSummary } from "@/services/ops/tenant";

const emptyUsage: StoreUsageSummary = {
  inbound24h: 0,
  outbound24h: 0,
  failed24h: 0,
  inbound7d: 0,
  outbound7d: 0,
  outboundMonth: 0,
  cap: null,
  overCap: false,
};

describe("tenantGate", () => {
  const base = {
    billingStatus: "ACTIVE" as const,
    whatsappEnabled: true,
    webEnabled: true,
    acceptingOrders: true,
    pausedReason: null,
    suspendedReason: null,
  };

  it("lets active stores through", () => {
    expect(tenantGate(base, "whatsapp").ok).toBe(true);
    expect(tenantGate(base, "web").ok).toBe(true);
  });

  it("cuts WhatsApp and web when billing is suspended", () => {
    const gate = tenantGate({ ...base, billingStatus: "SUSPENDED", suspendedReason: "No pay" }, "whatsapp");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("No pay");
    expect(tenantGate({ ...base, billingStatus: "SUSPENDED" }, "web").ok).toBe(false);
  });

  it("honours channel kill switches before kitchen pause copy", () => {
    expect(tenantGate({ ...base, webEnabled: false }, "web").ok).toBe(false);
    expect(tenantGate({ ...base, whatsappEnabled: false }, "whatsapp").ok).toBe(false);
    expect(tenantGate({ ...base, acceptingOrders: false, pausedReason: "Busy" }, "web").reason).toContain("Busy");
  });
});

describe("storeHealth", () => {
  it("marks suspended as down", () => {
    const health = storeHealth({
      billingStatus: "SUSPENDED",
      whatsappEnabled: false,
      webEnabled: false,
      acceptingOrders: true,
      whatsappLive: true,
      usage: emptyUsage,
      lastOutboundAt: new Date(),
      lastInboundAt: new Date(),
    });
    expect(health.level).toBe("down");
  });

  it("warns when past due or over cap", () => {
    expect(
      storeHealth({
        billingStatus: "PAST_DUE",
        whatsappEnabled: true,
        webEnabled: true,
        acceptingOrders: true,
        whatsappLive: true,
        usage: emptyUsage,
        lastOutboundAt: new Date(),
        lastInboundAt: new Date(),
      }).level,
    ).toBe("warn");

    expect(
      storeHealth({
        billingStatus: "ACTIVE",
        whatsappEnabled: true,
        webEnabled: true,
        acceptingOrders: true,
        whatsappLive: true,
        usage: { ...emptyUsage, outboundMonth: 5000, cap: 1000, overCap: true },
        lastOutboundAt: new Date(),
        lastInboundAt: new Date(),
      }).level,
    ).toBe("warn");
  });
});
