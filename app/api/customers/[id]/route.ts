import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { getCustomer, updateCustomer } from "@/services/customers";

export const GET = route<{ id: string }>(async ({ session, params }) => ({ customer: await getCustomer(session.businessId, params.id) }));

export const PUT = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(
    req,
    z.object({
      name: z.string().max(120).nullish(),
      phone: z.string().min(5).max(30).optional(),
      email: z.string().email().max(160).nullish().or(z.literal("")),
      preferredContactMethod: z.enum(["WHATSAPP", "EMAIL", "PHONE"]).optional(),
    }),
  );
  return { customer: await updateCustomer(session.actor, params.id, { ...body, email: body.email === "" ? null : body.email }) };
});
