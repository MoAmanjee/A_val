import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ForbiddenError, UnauthorizedError, AppError } from "@/lib/errors";
import type { UserActor } from "@/types/actor";

export const SESSION_COOKIE = "aq_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  businessId: string | null;
}

export interface Session {
  user: SessionUser;
  /** Present for every non-platform user. */
  businessId: string;
  actor: UserActor;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function secretKey() {
  return new TextEncoder().encode(env.authSecret);
}

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

// Naive in-memory limiter. Replace with Redis when running multiple instances.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) return;
  if (entry.count >= MAX_ATTEMPTS) {
    throw new AppError("RATE_LIMITED", "Too many login attempts. Please try again later.", 429);
  }
}

function recordFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
}

export function resetLoginRateLimits() {
  attempts.clear();
}

export async function authenticate(emailInput: string, password: string, ip = "unknown") {
  const email = emailInput.trim().toLowerCase();
  const key = `${ip}:${email}`;
  checkRateLimit(key);

  const user = await db.user.findUnique({ where: { email } });
  // Always run a hash comparison so response time does not reveal whether the account exists.
  const ok = await verifyPassword(
    password,
    user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi",
  );
  if (!user || !user.active || !ok) {
    recordFailure(key);
    throw new UnauthorizedError("Invalid email or password");
  }
  attempts.delete(key);
  const token = await signSessionToken(user.id);
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, businessId: user.businessId },
  };
}

export async function sessionFromToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const userId = await verifySessionToken(token);
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) return null;
  if (!user.businessId) return null;
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, businessId: user.businessId },
    businessId: user.businessId,
    actor: { kind: "user", userId: user.id, businessId: user.businessId, role: user.role, name: user.name },
  };
}

/** Platform-level user lookup (SUPER_ADMIN without a business is allowed here). */
export async function platformUserFromToken(token: string | undefined | null) {
  if (!token) return null;
  const userId = await verifySessionToken(token);
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) return null;
  return user;
}

export function assertRole(session: Session, roles: Role[]) {
  if (session.user.role === "SUPER_ADMIN") return;
  if (!roles.includes(session.user.role)) throw new ForbiddenError();
}
