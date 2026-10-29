import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { AppError } from "@/lib/errors";
import { stripeConfigured, stripePublishableKey } from "@/lib/stripe";
import { createWebPaymentIntent } from "@/services/orders/web-payment";
import { normalizePhone } from "@/utils/phone";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  amountCents: z.number().int().min(500).max(500_000),
  phone: z.string().min(8).max(20),
  name: z.string().trim().min(1, "Name is required").max(80),
});

/** Create a Stripe PaymentIntent so the mini-site can show Apple Pay / Samsung Pay / card. */
export async function POST(req: Request) {
  try {
    if (!stripeConfigured()) {
      return NextResponse.json(
        { error: "Online wallets are not configured. Use pay at collection, or set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY." },
        { status: 503 },
      );
    }
    const input = bodySchema.parse(await req.json());
    const phone = normalizePhone(input.phone);
    const result = await createWebPaymentIntent({
      amountCents: input.amountCents,
      phone,
      customerName: input.name,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      publishableKey: stripePublishableKey(),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid payment request", detail: error.flatten() }, { status: 400 });
    }
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("create payment failed", error);
    return NextResponse.json({ error: "Could not start online payment" }, { status: 500 });
  }
}

/** Public flag so the checkout UI knows whether to offer wallets. */
export async function GET() {
  return NextResponse.json({
    onlinePayments: stripeConfigured(),
    publishableKey: stripeConfigured() ? stripePublishableKey() : null,
    wallets: ["apple_pay", "samsung_pay", "google_pay", "card"],
  });
}
