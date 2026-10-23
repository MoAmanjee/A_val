import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, parseQuery, route } from "@/lib/api";
import { labourBody } from "@/lib/schemas";
import { createLabourRate, listLabourRates } from "@/services/labour";


export const GET = route(async ({ req, session }) => {
  const q = parseQuery(req, z.object({ all: z.string().optional() }));
  return { items: await listLabourRates(session.businessId, { includeInactive: q.all === "1" }) };
});

export const POST = route(async ({ req, session }) => {
  const body = await parseJson(req, labourBody);
  return NextResponse.json({ labourRate: await createLabourRate(session.actor, body) }, { status: 201 });
});
