import { after, NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { processWebhookPayload } from "@/services/whatsapp/processor";
import { verifyWebhookSignature } from "@/services/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Meta webhook verification handshake. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = env.whatsappVerifyToken;
  if (p.get("hub.mode") === "subscribe" && token && safeEqual(p.get("hub.verify_token") ?? "", token)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Incoming messages and delivery receipts. The payload is verified, then processed after
 * the 200 response so Meta never times out waiting for the AI (Meta retries on non-2xx).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();

  const secret = env.whatsappAppSecret;
  if (secret) {
    if (!verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
      return new NextResponse("Invalid signature", { status: 401 });
    }
  } else if (env.whatsappDriver !== "mock") {
    console.error("[whatsapp] WHATSAPP_APP_SECRET is not set; refusing unsigned webhook");
    return new NextResponse("Webhook signing secret is not configured", { status: 503 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  after(async () => {
    try {
      const summary = await processWebhookPayload(payload);
      if (summary.errors.length) console.error("[whatsapp] webhook processing errors", summary.errors);
    } catch (e) {
      console.error("[whatsapp] webhook processing crashed", e);
    }
  });
  return NextResponse.json({ received: true });
}
