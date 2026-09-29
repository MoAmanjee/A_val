import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { SESSION_COOKIE, authenticate, sessionCookieOptions } from "@/services/auth";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json().catch(() => ({})));
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const { token, user } = await authenticate(body.email, body.password, ip);
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
