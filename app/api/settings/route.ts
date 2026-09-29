import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { getBusiness, publicBusiness, updateBusinessSettings } from "@/services/settings";

const body = z.object({
  name: z.string().min(1).max(160).optional(),
  tradingName: z.string().max(160).nullish(),
  registrationNumber: z.string().max(60).nullish(),
  vatNumber: z.string().max(60).nullish(),
  address: z.string().max(500).nullish(),
  phone: z.string().max(40).nullish(),
  email: z.string().email().max(160).nullish().or(z.literal("")),
  whatsappNumber: z.string().max(40).nullish(),
  whatsappPhoneNumberId: z.string().max(60).nullish(),
  whatsappAccessToken: z.string().max(1000).optional(),
  currencySymbol: z.string().min(1).max(5).optional(),
  currency: z.string().min(3).max(3).optional(),
  vatRate: z.coerce.number().min(0).max(100).optional(),
  pricesIncludeVat: z.boolean().optional(),
  quotePrefix: z.string().max(10).optional(),
  quoteValidityDays: z.coerce.number().int().min(1).max(365).optional(),
  optionDisplayMode: z.enum(["CHEAPEST", "RECOMMENDED", "ALL", "BUSINESS_SELECTED"]).optional(),
  paymentDetails: z.string().max(2000).nullish(),
  termsAndConditions: z.string().max(8000).nullish(),
});

export const GET = route(async ({ session }) => ({ business: publicBusiness(await getBusiness(session.businessId)) }));

export const PUT = route(
  async ({ req, session }) => {
    const input = await parseJson(req, body);
    const updated = await updateBusinessSettings(session.actor, { ...input, email: input.email === "" ? null : input.email });
    return { business: publicBusiness(updated) };
  },
  { roles: ["BUSINESS_ADMIN"] },
);
