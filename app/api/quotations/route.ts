import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, parseQuery, route } from "@/lib/api";
import { quoteBody } from "@/lib/schemas";
import { pageQuery } from "@/lib/validation";
import { createQuotation, listQuotations } from "@/services/quotes/service";

const STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"] as const;

export const GET = route(async ({ req, session }) => {
  const q = parseQuery(
    req,
    z.object({
      q: z.string().optional(),
      status: z.enum(STATUSES).optional(),
      customer: z.string().optional(),
      customerId: z.string().optional(),
      vehicle: z.string().optional(),
      dateFrom: z.coerce.date().optional(),
      dateTo: z.coerce.date().optional(),
      ...pageQuery,
    }),
  );
  if (q.dateTo) q.dateTo.setUTCHours(23, 59, 59, 999);
  return listQuotations(session.businessId, q);
});

export const POST = route(async ({ req, session }) => {
  const body = await parseJson(req, quoteBody.extend({ customerId: z.string().min(1) }));
  const quotation = await createQuotation(session.actor, body);
  return NextResponse.json({ quotation }, { status: 201 });
});
