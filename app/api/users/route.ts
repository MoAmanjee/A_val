import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { createUser, listUsers } from "@/services/users";

export const GET = route(async ({ session }) => ({ items: await listUsers(session.businessId) }), { roles: ["BUSINESS_ADMIN"] });

export const POST = route(
  async ({ req, session }) => {
    const body = await parseJson(
      req,
      z.object({ name: z.string().min(1).max(120), email: z.string().email(), password: z.string().min(10).max(200), role: z.enum(["BUSINESS_ADMIN", "STAFF"]) }),
    );
    return NextResponse.json({ user: await createUser(session.actor, body) }, { status: 201 });
  },
  { roles: ["BUSINESS_ADMIN"] },
);
