import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, parseQuery, route } from "@/lib/api";
import { pageQuery } from "@/lib/validation";
import { vehicleBody } from "@/lib/schemas";
import { createVehicle, listVehicles } from "@/services/vehicles";


export const GET = route(async ({ req, session }) => {
  const q = parseQuery(req, z.object({ q: z.string().optional(), customerId: z.string().optional(), ...pageQuery }));
  return listVehicles(session.businessId, q);
});

export const POST = route(async ({ req, session }) => {
  const body = await parseJson(req, vehicleBody);
  const vehicle = await createVehicle(session.actor, body);
  return NextResponse.json({ vehicle }, { status: 201 });
});
