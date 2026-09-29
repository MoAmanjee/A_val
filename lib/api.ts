import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import type { Role } from "@prisma/client";
import { AppError, ForbiddenError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { SESSION_COOKIE, assertRole, sessionFromToken, type Session } from "@/services/auth";

export type RouteContext<P = Record<string, string>> = { params: Promise<P> };

export interface HandlerArgs<P> {
  req: NextRequest;
  session: Session;
  params: P;
}

function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new ForbiddenError("Cross-origin request blocked");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new ForbiddenError("Invalid origin");
  }
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION",
          message: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
          details: e.issues,
        },
      },
      { status: 400 },
    );
  }
  console.error("[api] unhandled error", e);
  const message = e instanceof Error ? e.message : "Unexpected error";
  // Authenticated business users get the real error; it is never sent to WhatsApp customers.
  return NextResponse.json({ error: { code: "INTERNAL", message } }, { status: 500 });
}

/**
 * Wrap an authenticated dashboard API handler: session check, role check,
 * same-origin check for mutations, uniform error responses.
 */
export function route<P = Record<string, string>>(
  handler: (args: HandlerArgs<P>) => Promise<NextResponse | Response | unknown>,
  opts: { roles?: Role[] } = {},
) {
  return async (req: NextRequest, ctx: RouteContext<P>) => {
    try {
      assertSameOrigin(req);
      const session = await sessionFromToken(req.cookies.get(SESSION_COOKIE)?.value);
      if (!session) throw new UnauthorizedError();
      if (opts.roles) assertRole(session, opts.roles);
      const params = ctx?.params ? await ctx.params : ({} as P);
      const result = await handler({ req, session, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function parseJson<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  return schema.parse(body);
}

export function parseQuery<T>(req: NextRequest, schema: ZodSchema<T>): T {
  const obj: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  return schema.parse(obj);
}
