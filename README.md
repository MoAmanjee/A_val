# AutoQuote - AI WhatsApp parts & quoting platform

A multi-tenant SaaS MVP for auto-parts suppliers. Customers message the business on WhatsApp; an AI
agent collects their details and the vehicle, the backend searches **your inventory and fitment
database deterministically**, and a **draft quotation** lands in the dashboard. Staff review, edit and
press **Approve & send**, and only then does the customer receive an official PDF on WhatsApp.

```
Customer --WhatsApp--> Meta Cloud API --> POST /api/webhooks/whatsapp
                                              |
                              AI agent (OpenAI, tools only)
                                              |
        inventory search + fitment matching + labour rates  (Postgres = source of truth)
                                              |
                  DRAFT -> PENDING_APPROVAL quotation (no customer message yet)
                                              |
        Dashboard: review / edit / Save draft / APPROVE & SEND
                                              |
         server recomputes totals -> locks pricing -> PDF -> WhatsApp -> SENT
```

## Non-negotiable rules (enforced in code, covered by tests)

| Rule | Where |
| --- | --- |
| The AI cannot approve, send, price or discount | `services/ai/tools.ts` exposes no such tool; the quote service ignores price/discount/VAT input from the `ai` actor |
| Totals are always computed server-side | `services/quotes/calc.ts`; the API ignores totals sent by the browser |
| DB is the source of truth for stock, fitment and price | `services/inventory/search.ts`, `services/vehicles/matching.ts` |
| Every record is scoped by `business_id` | every service takes an `Actor`; tests in `tests/isolation.test.ts` |
| Failed WhatsApp sends are never marked `SENT` and are retryable | `sendQuotation`, `retryFailedMessage` |
| The LLM never runs SQL | tools are fixed, validated functions bound to the business + conversation by the server |
| Customers never see internal errors | AI/processing failures give a friendly reply, flag `HUMAN_REQUIRED` and add an internal note with the real error |
| No secrets in the repo | everything comes from environment variables; per-business WhatsApp tokens are AES-256-GCM encrypted at rest |

## Stack

Next.js 15 (App Router) - TypeScript - Tailwind CSS 4 - PostgreSQL + Prisma - OpenAI (behind an `LLMClient`
interface) - pdfkit - exceljs/papaparse - Vitest.

```
app/            Next.js routes: (app)/ dashboard pages, api/ route handlers, login
components/     UI kit, app shell, import wizard
services/       ALL business logic (auth, customers, vehicles, inventory, quotes, pdf, whatsapp, ai, ...)
lib/            db, env, api wrapper, errors, crypto, client helpers
prisma/         schema + migrations + seed CLI
db/seed.ts      demo data (shared with the tests)
scripts/        create-business.ts (tenant onboarding)
tests/          Vitest suites (real Postgres)
```

The UI is intentionally thin: pages call the REST API, and the API calls the service layer. Business
rules live only in `services/`.

## Quick start

Requirements: Node 20+, PostgreSQL 14+ (or `docker compose up -d`).

```bash
cp .env.example .env            # then edit secrets (see below)
docker compose up -d            # optional: local Postgres on :5432
npm install                     # also runs prisma generate
npx prisma migrate deploy       # create tables
npm run db:seed                 # demo businesses, inventory, fitment, quotes
npm run dev                     # http://localhost:3000
```

Generate secrets with `openssl rand -base64 48` for `AUTH_SECRET` and `ENCRYPTION_KEY`.

For local development set `WHATSAPP_DRIVER="mock"` (messages are recorded in the database and the conversation
view instead of being sent to Meta). Without `OPENAI_API_KEY` the agent cannot reply: customers get the
friendly fallback message and the conversation is flagged for a human, with the reason shown in the dashboard.

### Demo logins (after `npm run db:seed`, password `Password123!`)

| Email | Role | Business |
| --- | --- | --- |
| `admin@elitecarspares.test` | Business admin | Elite Car Spares (ECS, 21 parts, 5 vehicles, 6 labour rates, sample quotes/conversations) |
| `staff@elitecarspares.test` | Staff | Elite Car Spares |
| `admin@capeauto.test` | Business admin | Cape Auto Parts (separate tenant used to prove isolation) |
| `owner@autoquote.test` | Super admin | Elite Car Spares |

Elite's WhatsApp phone number id is `DEMO_PHONE_ID_ELITE`, so you can simulate an incoming message locally:

```bash
curl -X POST localhost:3000/api/webhooks/whatsapp -H 'content-type: application/json' -d '{
  "object":"whatsapp_business_account","entry":[{"id":"W","changes":[{"field":"messages","value":{
    "messaging_product":"whatsapp","metadata":{"phone_number_id":"DEMO_PHONE_ID_ELITE"},
    "contacts":[{"profile":{"name":"Test"},"wa_id":"27831234000"}],
    "messages":[{"from":"27831234000","id":"wamid.TEST1","timestamp":"1700000000","type":"text","text":{"body":"Hi, I need front brake pads for a 2016 Golf 7 1.4 TSI"}}]}}]}]}'
```

## Environment variables

See `.env.example` for the full list. Key ones:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | signs session JWTs (httpOnly cookie, 7 days) |
| `ENCRYPTION_KEY` | encrypts per-business WhatsApp tokens stored in the DB |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | AI agent (server-side only) |
| `WHATSAPP_DRIVER` | `cloud` (Meta Cloud API) or `mock` |
| `WHATSAPP_VERIFY_TOKEN` | Meta webhook verification handshake |
| `WHATSAPP_APP_SECRET` | verifies `X-Hub-Signature-256` on webhooks (required unless the driver is `mock`) |
| `WHATSAPP_ACCESS_TOKEN` | optional platform-level token; a business can store its own in Settings |
| `STORAGE_DRIVER` | `local` or `s3` (any S3-compatible bucket: `S3_*` variables) |
| `VIN_DECODER` | `basic` (format validation only) or `nhtsa` |

## Connecting WhatsApp (Meta Cloud API)

1. Create a Meta app with the WhatsApp product and a business phone number.
2. Set the webhook callback URL to `https://<your-domain>/api/webhooks/whatsapp`, the verify token to your
   `WHATSAPP_VERIFY_TOKEN`, and subscribe to `messages`.
3. Set `WHATSAPP_APP_SECRET` (App settings -> Basic) so payload signatures are verified.
4. In the dashboard open **Settings -> WhatsApp connection** and enter the **Phone number ID** and a permanent
   access token. The phone number id routes each incoming message to the right business.

**24-hour window:** WhatsApp only allows free-form messages within 24 hours of the customer's last message.
Sending a quotation PDF later than that requires an approved message template; if Meta rejects the send, the
quotation stays `APPROVED` with the error shown on the quote, and you can retry once the customer writes
again. Template support is a natural next step behind the existing `WhatsAppService` interface.

## Onboarding another business

```bash
npx tsx scripts/create-business.ts --name "Cape Auto Parts" --prefix CAP \
  --admin-name "Jane Doe" --admin-email jane@example.com --password 'a-long-password' \
  --phone-number-id 1234567890
```

## How the pieces behave

- **Fitment** compares make, model, year, variant, engine, engine code, fuel and transmission. A conflicting
  dimension rejects a part; unknown dimensions lower the confidence (EXACT/HIGH/MEDIUM/LOW) and the assistant
  is told what to ask the customer. Universal parts skip fitment; parts without data are flagged "verify".
- **Option display** (Settings): show all compatible options, cheapest only, recommended only, or "I choose".
  Nothing is ever labelled "best" - only parts you flag as *Recommended* carry that label.
- **Quote lifecycle:** `DRAFT -> PENDING_APPROVAL -> APPROVED -> SENT -> ACCEPTED/REJECTED/EXPIRED`, or
  `CANCELLED`. Approval atomically locks pricing; concurrent approvals cannot both win. Quote numbers are
  sequential per business and year (`ECS-2026-000001`).
- **VAT** is per business (rate, and whether prices include VAT) and can be overridden per line.
- **Human handoff:** "speak to someone" (or an AI failure) sets `HUMAN_REQUIRED` and stops automated replies
  until staff reply, take over, or resume the AI.
- **Out of stock / not found:** the assistant logs a *Part request* lead instead of guessing.
- **Import:** inventory and fitment accept CSV or XLSX with a column-mapping step, per-row errors and
  update-by-SKU.
- **Audit:** every quote change (prices, lines, approval, sends, failures) and AI action is recorded with actor.

## Tests

```bash
createdb autoquote_test   # or set TEST_DATABASE_URL; migrations are applied automatically
npm test
```

The suite runs against real Postgres and covers vehicle matching, fitment, inventory search, quote maths,
VAT, discounts, labour, approval workflow, PDF generation, business isolation (service and HTTP layers),
WhatsApp webhook processing, AI tool calls, spreadsheet imports and a full enquiry-to-PDF end-to-end flow.

## Roadmap ideas

Customer-facing accept/decline link, WhatsApp templates for out-of-window sends, payment links, supplier
price-list sync, a decoder integration for South African VINs, stock reservation on approval, Redis-backed
locks and rate limiting for multi-instance deployments.
