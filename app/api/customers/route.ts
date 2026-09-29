import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, parseQuery, route } from "@/lib/api";
import { pageQuery } from "@/lib/validation";
import { createCustomer, listCustomers } from "@/services/customers";

export const GET = route(async ({ req, session }) => {
  const q = parseQuery(req, z.object({ q: z.string().optional(), ...pageQuery }));
  return listCustomers(session.businessId, q);
});

export const POST = route(async ({ req, session }) => {
  const body = await parseJson(
    req,
    z.object({
      name: z.string().max(120).nullish(),
      phone: z.string().min(5).max(30),
      email: z.string().email().max(160).nullish().or(z.literal("")),
      preferredContactMethod: z.enum(["WHATSAPP", "EMAIL", "PHONE"]).optional(),
    }),
  );
  const customer = await createCustomer(session.actor, { ...body, email: body.email || null });
  return NextResponse.json({ customer }, { status: 201 });
});
