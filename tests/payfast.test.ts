import { describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-at-least-32-chars!!";
process.env.AUTH_SECRET ||= "test-auth-secret-at-least-32-characters!!";

const { buildPayfastUpdate, payfastStatus, PAYFAST_LINKS } = await import("@/services/payments/payfast");

describe("payfastStatus", () => {
  it("is not configured without id + key", () => {
    expect(
      payfastStatus({
        payfastMerchantId: null,
        payfastMerchantKeyEnc: null,
        payfastPassphraseEnc: null,
        payfastMode: "sandbox",
        payfastEnabled: false,
      }).configured,
    ).toBe(false);

    expect(
      payfastStatus({
        payfastMerchantId: "10000100",
        payfastMerchantKeyEnc: null,
        payfastPassphraseEnc: null,
        payfastMode: "sandbox",
        payfastEnabled: true,
      }).configured,
    ).toBe(false);
  });

  it("reports configured when id and encrypted key exist", () => {
    const status = payfastStatus({
      payfastMerchantId: " 10000100 ",
      payfastMerchantKeyEnc: "enc",
      payfastPassphraseEnc: "enc2",
      payfastMode: "live",
      payfastEnabled: true,
    });
    expect(status).toMatchObject({
      configured: true,
      enabled: true,
      mode: "live",
      merchantId: "10000100",
      hasMerchantKey: true,
      hasPassphrase: true,
    });
  });
});

describe("buildPayfastUpdate", () => {
  it("encrypts secrets and clears blanks", () => {
    const withSecrets = buildPayfastUpdate({
      merchantId: "10000100",
      merchantKey: "secret-key",
      passphrase: "salt",
      mode: "sandbox",
      enabled: true,
    });
    expect(withSecrets.payfastMerchantId).toBe("10000100");
    expect(withSecrets.payfastMerchantKeyEnc).toBeTruthy();
    expect(withSecrets.payfastMerchantKeyEnc).not.toContain("secret-key");
    expect(withSecrets.payfastPassphraseEnc).toBeTruthy();
    expect(withSecrets.payfastMode).toBe("sandbox");
    expect(withSecrets.payfastEnabled).toBe(true);

    const cleared = buildPayfastUpdate({ merchantKey: "", passphrase: "  " });
    expect(cleared.payfastMerchantKeyEnc).toBeNull();
    expect(cleared.payfastPassphraseEnc).toBeNull();
  });
});

describe("PAYFAST_LINKS", () => {
  it("points at PayFast signup", () => {
    expect(PAYFAST_LINKS.signup).toContain("payfast.co.za");
  });
});
