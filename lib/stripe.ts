import Stripe from "stripe";
import { env } from "@/lib/env";

let client: Stripe | null = null;

/** True when both Stripe keys are set — otherwise checkout stays pay-at-collection only. */
export function stripeConfigured(): boolean {
  return Boolean(env.stripeSecretKey && env.stripePublishableKey);
}

export function getStripe(): Stripe {
  if (!env.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  if (!client) {
    client = new Stripe(env.stripeSecretKey, {
      apiVersion: "2026-09-30.endive",
      typescript: true,
    });
  }
  return client;
}

export function stripePublishableKey(): string {
  return env.stripePublishableKey;
}
