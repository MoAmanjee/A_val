import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { processWebhookPayload } from "@/services/whatsapp/processor";
import { verifyWebhookSignature } from "@/services/whatsapp";

/** Meta's webhook verification handshake. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = env.whatsappVerifyToken;
  if (mode === "subscribe" && token && expected && safeEqual(token, expected) && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Inbound messages and delivery receipts. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (env.whatsappDriver !== "mock") {
    const ok = verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"));
    if (!ok) return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response("Expected JSON", { status: 400 });
  }

  const summary = await processWebhookPayload(payload);
  return Response.json({ ok: summary.errors.length === 0, ...summary });
}
