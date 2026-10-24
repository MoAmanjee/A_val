import type Stripe from "stripe";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { InvalidStateError } from "@/lib/errors";

export type WalletHint = "apple_pay" | "google_pay" | "samsung_pay" | "card" | "link" | "unknown";

/**
 * Create a ZAR PaymentIntent for the mini-site cart total.
 * Apple Pay / Google Pay come free with `card` + automatic methods.
 * Samsung Pay is requested explicitly when Stripe has it enabled for the account.
 */
export async function createWebPaymentIntent(input: {
  amountCents: number;
  phone: string;
  customerName?: string;
}): Promise<{ clientSecret: string; paymentIntentId: string; publishableKey: string }> {
  if (!stripeConfigured()) {
    throw new InvalidStateError("Online payment is not configured yet — choose pay at collection");
  }
  if (input.amountCents < 500) {
    throw new InvalidStateError("Online payment needs a total of at least R5.00");
  }

  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create({
    amount: input.amountCents,
    currency: "zar",
    // Wallets: Apple Pay + Google Pay via card; Samsung Pay when dashboard-enabled.
    automatic_payment_methods: { enabled: true },
    payment_method_options: {
      card: { request_three_d_secure: "automatic" },
    },
    metadata: {
      source: "mochachos_order_minisite",
      phone: input.phone.slice(0, 32),
      customer_name: (input.customerName ?? "").slice(0, 80),
    },
    description: "Mochachos Potch CBD online order",
    receipt_email: undefined,
  });

  if (!intent.client_secret) {
    throw new InvalidStateError("Could not start online payment");
  }

  const { stripePublishableKey } = await import("@/lib/stripe");
  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    publishableKey: stripePublishableKey(),
  };
}

/** Map Stripe payment_method type / wallet to a short kitchen label. */
export function walletFromPaymentIntent(intent: Stripe.PaymentIntent): WalletHint {
  const pm = intent.payment_method;
  if (!pm || typeof pm === "string") {
    // Fall back to latest charge wallet if expanded later.
    return "unknown";
  }
  const type = pm.type;
  if (type === "samsung_pay") return "samsung_pay";
  if (type === "card") {
    const wallet = pm.card?.wallet?.type;
    if (wallet === "apple_pay") return "apple_pay";
    if (wallet === "google_pay") return "google_pay";
    if (wallet === "samsung_pay") return "samsung_pay";
    return "card";
  }
  if (type === "link") return "link";
  return "unknown";
}

/**
 * Confirm the PaymentIntent succeeded and matches the cart total before we
 * ticket the kitchen. Prevents placing an unpaid "online" order.
 */
export async function assertPaidIntent(paymentIntentId: string, expectedCents: number): Promise<{
  intent: Stripe.PaymentIntent;
  method: WalletHint;
}> {
  if (!stripeConfigured()) {
    throw new InvalidStateError("Online payment is not configured");
  }
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["payment_method"],
  });

  if (intent.status !== "succeeded") {
    throw new InvalidStateError("Payment has not completed yet — finish Apple Pay / Samsung Pay / card first");
  }
  if (intent.currency !== "zar") {
    throw new InvalidStateError("Payment currency mismatch");
  }
  if (intent.amount !== expectedCents) {
    throw new InvalidStateError("Payment amount does not match the cart total");
  }

  return { intent, method: walletFromPaymentIntent(intent) };
}
