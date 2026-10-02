import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SeedResult } from "@/db/seed";
import { ExternalServiceError, ValidationError } from "@/lib/errors";
import { CloudApiWhatsAppService } from "@/services/whatsapp/cloud";
import { getIntegrationStatus, testWhatsAppConnection } from "@/services/whatsapp/status";
import { WhatsAppError } from "@/services/whatsapp/types";
import { resetAndSeed } from "./helpers";

const ENV_KEYS = [
  "WHATSAPP_DRIVER",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
  "OPENAI_API_KEY",
  "APP_URL",
] as const;

const snapshot: Record<string, string | undefined> = {};

function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) {
    if (k in vars) process.env[k] = vars[k as keyof typeof vars];
  }
}

const readyEnv = {
  WHATSAPP_DRIVER: "cloud",
  WHATSAPP_ACCESS_TOKEN: "EAA.test",
  WHATSAPP_APP_SECRET: "app-secret",
  WHATSAPP_VERIFY_TOKEN: "a-long-verify-token",
  OPENAI_API_KEY: "sk-test",
  APP_URL: "https://quotes.example.com",
};

beforeAll(() => {
  for (const k of ENV_KEYS) snapshot[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getIntegrationStatus", () => {
  it("lists mock-driver and missing live pieces as blockers", () => {
    setEnv({
      WHATSAPP_DRIVER: "mock",
      WHATSAPP_ACCESS_TOKEN: "",
      WHATSAPP_APP_SECRET: "",
      WHATSAPP_VERIFY_TOKEN: "change-me",
      OPENAI_API_KEY: "",
      APP_URL: "http://localhost:3000",
    });
    const s = getIntegrationStatus({ whatsappPhoneNumberId: null, whatsappAccessTokenEnc: null });
    expect(s.driver).toBe("mock");
    expect(s.liveReady).toBe(false);
    expect(s.webhookPublic).toBe(false);
    expect(s.webhookUrl).toBe("http://localhost:3000/api/webhooks/whatsapp");
    expect(s.blockers.map((b) => b.code)).toEqual(["driver", "phone", "token", "secret", "verify", "url", "openai"]);
  });

  it("rejects localhost and plain HTTP APP_URL even when the rest is set", () => {
    setEnv({ ...readyEnv, APP_URL: "http://localhost:3000" });
    expect(getIntegrationStatus({ whatsappPhoneNumberId: "123", whatsappAccessTokenEnc: "enc" }).blockers.map((b) => b.code)).toEqual(["url"]);

    setEnv({ ...readyEnv, APP_URL: "http://quotes.example.com" });
    expect(getIntegrationStatus({ whatsappPhoneNumberId: "123", whatsappAccessTokenEnc: "enc" }).blockers.map((b) => b.code)).toEqual(["url"]);
  });

  it("is liveReady when cloud driver, public HTTPS, secrets, OpenAI and business creds are present", () => {
    setEnv(readyEnv);
    const s = getIntegrationStatus({ whatsappPhoneNumberId: "10987654321", whatsappAccessTokenEnc: "enc" });
    expect(s).toMatchObject({
      driver: "cloud",
      liveReady: true,
      webhookPublic: true,
      tokenConfigured: true,
      phoneNumberIdConfigured: true,
      appSecretConfigured: true,
      openaiConfigured: true,
      webhookUrl: "https://quotes.example.com/api/webhooks/whatsapp",
    });
    expect(s.blockers).toEqual([]);
  });

  it("treats a platform-level access token as configured", () => {
    setEnv({ ...readyEnv, WHATSAPP_ACCESS_TOKEN: "EAA.platform" });
    const s = getIntegrationStatus({ whatsappPhoneNumberId: "1", whatsappAccessTokenEnc: null });
    expect(s.tokenConfigured).toBe(true);
    expect(s.liveReady).toBe(true);
  });
});

describe("CloudApiWhatsAppService.verifyPhoneNumber", () => {
  it("GETs the Graph phone-number profile and never posts a customer message", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toMatch(/\/10987\?fields=id,display_phone_number,verified_name,quality_rating$/);
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok_abc");
      return {
        ok: true,
        json: async () => ({
          id: "10987",
          display_phone_number: "+27 11 555 0100",
          verified_name: "Elite Car Spares",
          quality_rating: "GREEN",
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const profile = await new CloudApiWhatsAppService().verifyPhoneNumber({ phoneNumberId: "10987", accessToken: "tok_abc" });
    expect(profile).toEqual({
      id: "10987",
      displayPhoneNumber: "+27 11 555 0100",
      verifiedName: "Elite Car Spares",
      qualityRating: "GREEN",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("/messages");
  });

  it("surfaces Graph OAuth errors without sending a message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "Invalid OAuth access token", code: 190 } }),
      })),
    );
    await expect(new CloudApiWhatsAppService().verifyPhoneNumber({ phoneNumberId: "1", accessToken: "bad" })).rejects.toBeInstanceOf(WhatsAppError);
    await expect(new CloudApiWhatsAppService().verifyPhoneNumber({ phoneNumberId: "1", accessToken: "bad" })).rejects.toThrow(/190.*Invalid OAuth/);
  });
});

describe("testWhatsAppConnection", () => {
  let s: SeedResult;

  beforeAll(async () => {
    s = await resetAndSeed();
  });

  it("requires a phone number id and token before hitting Graph", async () => {
    setEnv({ WHATSAPP_ACCESS_TOKEN: "" });
    await expect(testWhatsAppConnection(s.actorA, { phoneNumberId: "", accessToken: "" })).rejects.toBeInstanceOf(ValidationError);

    await expect(testWhatsAppConnection(s.actorA, { phoneNumberId: "10987", accessToken: "" })).rejects.toThrow(/access token/i);
  });

  it("returns the Graph profile and writes an audit row on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          id: "DEMO_PHONE_ID_ELITE",
          display_phone_number: "27115550100",
          verified_name: "Elite Car Spares",
          quality_rating: "GREEN",
        }),
      })),
    );
    const out = await testWhatsAppConnection(s.actorA, { accessToken: "EAA.live" });
    expect(out.ok).toBe(true);
    expect(out.profile.verifiedName).toBe("Elite Car Spares");

    const { prisma } = await import("./helpers");
    const log = await prisma.auditLog.findFirst({ where: { businessId: s.businessA.id, action: "whatsapp.test" }, orderBy: { createdAt: "desc" } });
    expect(log?.summary).toMatch(/Elite Car Spares/);
  });

  it("maps WhatsApp API failures to ExternalServiceError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Unsupported get request", code: 100 } }),
      })),
    );
    await expect(testWhatsAppConnection(s.actorA, { accessToken: "EAA.bad" })).rejects.toBeInstanceOf(ExternalServiceError);
  });
});
