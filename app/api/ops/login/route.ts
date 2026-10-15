import { env } from "@/lib/env";
import { writeOpsSession } from "@/lib/session";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  if (!/^\d{4,8}$/.test(pin)) {
    return Response.json({ error: "Enter the ops PIN." }, { status: 400 });
  }
  if (pin !== env.opsPin) {
    return Response.json({ error: "That PIN is not right." }, { status: 401 });
  }
  await writeOpsSession();
  return Response.json({ ok: true });
}
