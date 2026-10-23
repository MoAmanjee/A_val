import { clearKitchenSession } from "@/lib/session";

export async function POST() {
  await clearKitchenSession();
  return Response.json({ ok: true });
}
