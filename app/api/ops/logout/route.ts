import { clearOpsSession } from "@/lib/session";

export async function POST() {
  await clearOpsSession();
  return Response.json({ ok: true });
}
