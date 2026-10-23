import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, parseQuery, route } from "@/lib/api";
import { pageQuery } from "@/lib/validation";
import { partBody } from "@/lib/schemas";
import { createPart, listParts } from "@/services/inventory";


export const GET = route(async ({ req, session }) => {
  const q = parseQuery(
    req,
    z.object({
      q: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(["active", "inactive", "all"]).optional(),
      stock: z.enum(["all", "low", "out", "in"]).optional(),
      sort: z.enum(["name", "sku", "stock", "price", "updated"]).optional(),
      dir: z.enum(["asc", "desc"]).optional(),
      ...pageQuery,
    }),
  );
  return listParts(session.businessId, q);
});

export const POST = route(async ({ req, session }) => {
  const body = await parseJson(req, partBody);
  const part = await createPart(session.actor, body);
  return NextResponse.json({ part }, { status: 201 });
});
