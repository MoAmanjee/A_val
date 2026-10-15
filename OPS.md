# Ops console — monitor sites, cut off non-payers

Open **`/ops`** and sign in with `OPS_PIN` (falls back to `KITCHEN_PIN`).

Health probe (no login): **`GET /api/health`**.

## What you can do today

| Control | Effect |
|--------|--------|
| **WhatsApp on/off** | Blocks new WhatsApp orders; still replies once that the service is unavailable |
| **Web /order on/off** | Blocks the mini-site cart / place-order API |
| **Kitchen accepting** | Shop pause (busy night) — separate from billing |
| **Billing → Past due** | Warns in the console; site stays online |
| **Billing → Suspended** / **Cut off** | Turns off WhatsApp + web and shows your reason |
| **Restore service** | Sets billing Active and turns channels back on |
| **Message stats** | Inbound/outbound today, 7 days, month (+ optional monthly cap warning) |

Every WhatsApp send/receive increments `store_usage_days` so you can see who burns Meta messages.

## When a restaurant stops paying

1. Open `/ops`
2. Optional: type a suspend reason (“Payment overdue — call Mo”)
3. Tap **Cut off (non-payment)**  
   → `billingStatus = SUSPENDED`, WhatsApp + web off  
4. When they pay: **Restore service**

## Growing to more websites / variants

You already have multi-store columns: `slug`, `variant`, WhatsApp phone id per store, usage per store.

Suggested path:

1. **One deploy per customer** (simplest) — each gets their own `APP_URL`, DB, WhatsApp number; your `/ops` on a *platform* deploy lists them via a shared ops DB later, **or** you bookmark each site’s `/ops`.
2. **One platform deploy** (next step) — many `Store` rows, route `/order/[slug]`, webhook routes by `whatsappPhoneNumberId` (already does). Variants = different menus/themes keyed by `store.variant`.
3. **Billing automation** — Stripe Customer + Subscription per store; webhook sets `billingStatus` to `PAST_DUE` / `SUSPENDED` instead of a manual toggle.

Do not put restaurant kitchen PINs on the ops console. Keep `OPS_PIN` only for you.

## Env

```bash
OPS_PIN="your-private-pin"   # optional; defaults to KITCHEN_PIN
```
