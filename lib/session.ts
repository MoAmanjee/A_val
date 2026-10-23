import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

const COOKIE = "kitchen_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

function secret(): Uint8Array {
  return new TextEncoder().encode(env.authSecret);
}

export async function signKitchenSession(storeId: string): Promise<string> {
  return new SignJWT({ storeId, role: "kitchen" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function readKitchenSession(): Promise<{ storeId: string } | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.role !== "kitchen" || typeof payload.storeId !== "string") return null;
    return { storeId: payload.storeId };
  } catch {
    return null;
  }
}

export async function writeKitchenSession(storeId: string): Promise<void> {
  const token = await signKitchenSession(storeId);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: env.nodeEnv === "production",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearKitchenSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
