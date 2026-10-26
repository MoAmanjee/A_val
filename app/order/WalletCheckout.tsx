"use client";

import { useEffect, useMemo, useState } from "react";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

function formatR(cents: number): string {
  const n = Math.round(cents);
  const whole = Math.floor(Math.abs(n) / 100);
  const frac = String(Math.abs(n) % 100).padStart(2, "0");
  return `R${whole}.${frac}`;
}

function PayForm({
  totalCents,
  onPaid,
  onError,
  pending,
}: {
  totalCents: number;
  onPaid: (paymentIntentId: string) => void;
  onError: (message: string) => void;
  pending: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!stripe || !elements) return;
    setBusy(true);
    onError("");
    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url: typeof window !== "undefined" ? `${window.location.origin}/order?paid=1` : undefined,
        },
      });
      if (result.error) {
        onError(result.error.message ?? "Payment failed");
        return;
      }
      const intent = result.paymentIntent;
      if (intent?.status === "succeeded" && intent.id) {
        onPaid(intent.id);
        return;
      }
      onError("Payment did not finish — try Apple Pay, Samsung Pay, or card again");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="order-wallet">
      <p className="order-muted">
        Apple Pay, Samsung Pay, Google Pay, and cards — total {formatR(totalCents)}.
      </p>
      <div className="order-express">
        <ExpressCheckoutElement
          options={{
            buttonHeight: 48,
            paymentMethods: {
              applePay: "always",
              googlePay: "always",
              link: "auto",
              paypal: "never",
              amazonPay: "never",
              klarna: "never",
            },
          }}
          onConfirm={async () => {
            await confirm();
          }}
        />
      </div>
      <p className="order-wallet-or">or pay with card / Samsung Pay</p>
      <PaymentElement
        options={{
          layout: "tabs",
          wallets: {
            applePay: "auto",
            googlePay: "auto",
          },
        }}
      />
      <button
        type="button"
        className="order-btn-primary"
        disabled={busy || pending || !stripe || !elements}
        onClick={() => void confirm()}
      >
        {busy || pending ? "Confirming payment…" : `Pay ${formatR(totalCents)} & place order`}
      </button>
    </div>
  );
}

export function WalletCheckout({
  clientSecret,
  publishableKey,
  totalCents,
  onPaid,
  onError,
  pending,
}: {
  clientSecret: string;
  publishableKey: string;
  totalCents: number;
  onPaid: (paymentIntentId: string) => void;
  onError: (message: string) => void;
  pending: boolean;
}) {
  const stripePromise = useMemo(() => loadStripe(publishableKey) as Promise<Stripe | null>, [publishableKey]);

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#e10600",
            borderRadius: "12px",
            fontFamily: "Manrope, Avenir Next, sans-serif",
          },
        },
      }}
    >
      <PayForm totalCents={totalCents} onPaid={onPaid} onError={onError} pending={pending} />
    </Elements>
  );
}

/** Loads whether Stripe wallets are available on this deployment. */
export function useOnlinePaymentsAvailable(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/order/payment")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setReady(Boolean(data.onlinePayments));
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}
