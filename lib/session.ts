import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionFromToken, type Session } from "@/services/auth";

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return sessionFromToken(store.get(SESSION_COOKIE)?.value);
}

/** For server components/pages: redirect to /login when unauthenticated. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
