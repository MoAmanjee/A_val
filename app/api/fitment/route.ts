import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, parseQuery, route } from "@/lib/api";
import { pageQuery } from "@/lib/validation";
import { fitmentBody } from "@/lib/schemas";
import { addFitment, listFitment } from "@/services/inventory";


export const GET = route(async ({ req, session }) => {
  const q = parseQuery(req, z.object({ q: z.string().optional(), partId: z.string().optional(), ...pageQuery }));
  return listFitment(session.businessId, q);
});

export const POST = route(async ({ req, session }) => {
  const body = await parseJson(req, fitmentBody.extend({ partId: z.string().min(1) }));
  const { partId, ...input } = body;
  return NextResponse.json({ fitment: await addFitment(session.actor, partId, input) }, { status: 201 });
});
