import { encryptSecret } from "@/lib/crypto";

export type PayfastMode = "sandbox" | "live";

export interface PayfastPublicStatus {
  configured: boolean;
  enabled: boolean;
  mode: PayfastMode;
  merchantId: string | null;
  hasMerchantKey: boolean;
  hasPassphrase: boolean;
}

export function payfastStatus(store: {
  payfastMerchantId: string | null;
  payfastMerchantKeyEnc: string | null;
  payfastPassphraseEnc: string | null;
  payfastMode: string;
  payfastEnabled: boolean;
}): PayfastPublicStatus {
  const mode: PayfastMode = store.payfastMode === "live" ? "live" : "sandbox";
  const merchantId = store.payfastMerchantId?.trim() || null;
  const hasMerchantKey = Boolean(store.payfastMerchantKeyEnc);
  return {
    configured: Boolean(merchantId && hasMerchantKey),
    enabled: store.payfastEnabled,
    mode,
    merchantId,
    hasMerchantKey,
    hasPassphrase: Boolean(store.payfastPassphraseEnc),
  };
}

/** Normalise and encrypt credentials for DB write. Empty strings clear secrets. */
export function buildPayfastUpdate(input: {
  merchantId?: string | null;
  merchantKey?: string | null;
  passphrase?: string | null;
  mode?: string | null;
  enabled?: boolean;
}) {
  const data: {
    payfastMerchantId?: string | null;
    payfastMerchantKeyEnc?: string | null;
    payfastPassphraseEnc?: string | null;
    payfastMode?: string;
    payfastEnabled?: boolean;
  } = {};

  if (input.merchantId !== undefined) {
    const id = typeof input.merchantId === "string" ? input.merchantId.trim() : "";
    data.payfastMerchantId = id || null;
  }
  if (input.merchantKey !== undefined) {
    const key = typeof input.merchantKey === "string" ? input.merchantKey.trim() : "";
    data.payfastMerchantKeyEnc = key ? encryptSecret(key) : null;
  }
  if (input.passphrase !== undefined) {
    const pass = typeof input.passphrase === "string" ? input.passphrase.trim() : "";
    data.payfastPassphraseEnc = pass ? encryptSecret(pass) : null;
  }
  if (input.mode === "sandbox" || input.mode === "live") {
    data.payfastMode = input.mode;
  }
  if (typeof input.enabled === "boolean") {
    data.payfastEnabled = input.enabled;
  }

  return data;
}

/** Official signup / dashboard links to send restaurant owners. */
export const PAYFAST_LINKS = {
  signup: "https://www.payfast.co.za/user/register",
  login: "https://www.payfast.co.za/login",
  docs: "https://developers.payfast.co.za/docs",
  sandbox: "https://sandbox.payfast.co.za/",
} as const;
