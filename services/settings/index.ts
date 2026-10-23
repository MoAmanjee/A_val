import type { Business, OptionDisplayMode, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/services/audit";
import { getStorage } from "@/services/storage";
import type { Actor } from "@/types/actor";
import { normalizePhone } from "@/utils/phone";

export interface BusinessSettingsInput {
  name?: string;
  tradingName?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsappNumber?: string | null;
  whatsappPhoneNumberId?: string | null;
  /** Write-only. Empty string clears the stored token. */
  whatsappAccessToken?: string;
  currencySymbol?: string;
  currency?: string;
  vatRate?: number;
  pricesIncludeVat?: boolean;
  quotePrefix?: string;
  quoteValidityDays?: number;
  optionDisplayMode?: OptionDisplayMode;
  paymentDetails?: string | null;
  termsAndConditions?: string | null;
}

/** Public shape: never includes encrypted secrets. */
export function publicBusiness(b: Business) {
  const { whatsappAccessTokenEnc, ...rest } = b;
  return {
    ...rest,
    vatRate: Number(b.vatRate),
    whatsappTokenConfigured: !!whatsappAccessTokenEnc,
  };
}

export async function getBusiness(businessId: string) {
  const b = await db.business.findUnique({ where: { id: businessId } });
  if (!b) throw new NotFoundError("Business");
  return b;
}

export async function updateBusinessSettings(actor: Actor, input: BusinessSettingsInput) {
  const existing = await getBusiness(actor.businessId);
  const data: Prisma.BusinessUpdateInput = {};

  const text = ["tradingName", "registrationNumber", "vatNumber", "address", "phone", "email", "paymentDetails", "termsAndConditions"] as const;
  for (const f of text) if (input[f] !== undefined) data[f] = input[f]?.toString().trim() || null;
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new ValidationError("Business name is required");
    data.name = input.name.trim();
  }
  if (input.currencySymbol !== undefined) data.currencySymbol = input.currencySymbol.trim() || "R";
  if (input.currency !== undefined) data.currency = input.currency.trim().toUpperCase() || "ZAR";
  if (input.vatRate !== undefined) {
    if (input.vatRate < 0 || input.vatRate > 100) throw new ValidationError("VAT rate must be between 0 and 100");
    data.vatRate = input.vatRate.toFixed(2);
  }
  if (input.pricesIncludeVat !== undefined) data.pricesIncludeVat = input.pricesIncludeVat;
  if (input.quotePrefix !== undefined) {
    const p = input.quotePrefix.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(p)) throw new ValidationError("Quote prefix must be 1-10 letters or digits");
    data.quotePrefix = p;
  }
  if (input.quoteValidityDays !== undefined) {
    if (!Number.isInteger(input.quoteValidityDays) || input.quoteValidityDays < 1 || input.quoteValidityDays > 365) {
      throw new ValidationError("Quote validity must be between 1 and 365 days");
    }
    data.quoteValidityDays = input.quoteValidityDays;
  }
  if (input.optionDisplayMode) data.optionDisplayMode = input.optionDisplayMode;
  if (input.whatsappNumber !== undefined) data.whatsappNumber = input.whatsappNumber ? normalizePhone(input.whatsappNumber) : null;
  if (input.whatsappPhoneNumberId !== undefined) {
    const id = input.whatsappPhoneNumberId?.trim() || null;
    if (id && id !== existing.whatsappPhoneNumberId) {
      const clash = await db.business.findUnique({ where: { whatsappPhoneNumberId: id } });
      if (clash) throw new ConflictError("This WhatsApp phone number ID is already connected to another business");
    }
    data.whatsappPhoneNumberId = id;
  }
  if (input.whatsappAccessToken !== undefined) {
    data.whatsappAccessTokenEnc = input.whatsappAccessToken ? encryptSecret(input.whatsappAccessToken) : null;
  }

  const changed = Object.keys(data).filter((k) => k !== "whatsappAccessTokenEnc");
  const details: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of changed) {
    const from = (existing as Record<string, unknown>)[k];
    const to = (data as Record<string, unknown>)[k];
    if (String(from ?? "") !== String(to ?? "")) details[k] = { from: from === null ? null : String(from), to: to === null ? null : String(to) };
  }
  const updated = await db.business.update({ where: { id: actor.businessId }, data });
  await audit(actor, {
    action: "settings.update",
    entityType: "Business",
    entityId: actor.businessId,
    summary: `Settings updated (${[...Object.keys(details), ...(input.whatsappAccessToken !== undefined ? ["whatsappAccessToken"] : [])].join(", ") || "no changes"})`,
    details: details as Prisma.InputJsonValue,
  });
  return updated;
}

const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };

export async function uploadLogo(actor: Actor, data: Buffer, contentType: string) {
  const ext = LOGO_TYPES[contentType];
  if (!ext) throw new ValidationError("Logo must be a PNG or JPEG image");
  if (data.length > 2 * 1024 * 1024) throw new ValidationError("Logo must be smaller than 2MB");
  const key = `${actor.businessId}/logo/logo-${Date.now()}.${ext}`;
  await getStorage().put(key, data, contentType);
  const updated = await db.business.update({
    where: { id: actor.businessId },
    data: { logoKey: key, logoUrl: `/api/files/${key}` },
  });
  await audit(actor, { action: "settings.logo", entityType: "Business", entityId: actor.businessId, summary: "Logo updated" });
  return updated;
}
