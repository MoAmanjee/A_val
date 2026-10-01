# BookBot

Multi-tenant booking page + WhatsApp reminder service for small South African appointment businesses
(salons, barbers, tutors, mechanics). Each business signs up, adds services and hours, and gets a public
booking link. Reminders go out automatically 24h before each appointment. 14-day free trial, then a
monthly subscription (default R299, set `PRICE_ZAR`).

## Run locally

```bash
pip install -r requirements.txt
python3 -m pytest -q
SECRET_KEY=change-me ADMIN_KEY=change-me flask --app app run
```

## Deploy (about R100-R200/month)

Any small VPS or PaaS that can run Python (Hetzner/Afrihost VPS, Render, Fly.io):

```bash
SECRET_KEY=<random> ADMIN_KEY=<random> DATABASE=/data/bookbot.db \
PAYMENT_LINK=<your Payfast/Yoco/Paystack subscription link> \
gunicorn -w 2 -b 0.0.0.0:8000 app:app
```

Put it behind HTTPS (Caddy or the PaaS's built-in TLS) and keep `/data` on a persistent disk with
daily backups of `bookbot.db`.

Reminders (cron, every 15 minutes):

```
*/15 * * * * cd /path/to/bookbot && DATABASE=/data/bookbot.db WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=... python3 reminders.py
```

Without `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` the script only prints what it would send.
Meta's WhatsApp Cloud API requires an approved Business account, and messages sent outside the 24-hour
customer window must use a pre-approved template. Create a reminder template in Meta Business Manager and
update `reminders.send_whatsapp` to send it before going live.

## Activating a paying customer

After a customer pays, activate them (no auto-billing webhook yet):

```bash
curl -X POST https://yourdomain/admin/activate -d key=$ADMIN_KEY -d slug=cool-cuts -d status=active
```

## Known limitations

- Single timezone (server local time, set the server to Africa/Johannesburg).
- Payments are manual activation. A Payfast/Paystack webhook calling the same logic is the next step.
- SQLite is fine for hundreds of businesses; move to Postgres beyond that.

## Owner approval queue (money gate)

Anything that spends or moves money (ad spend, refunds, payouts) must be requested through the approval
queue and is only executed after the owner approves it at `/owner` (log in with `ADMIN_KEY`).

```bash
# automation requests approval
curl -X POST https://yourdomain/admin/approvals -d key=$ADMIN_KEY -d kind=ad_spend \
  -d description="Facebook ads week 1" -d amount_zar=500
# automation polls for approved items, executes them, then marks them done
curl "https://yourdomain/admin/approvals?key=$ADMIN_KEY&status=approved"
curl -X POST https://yourdomain/admin/approvals/1/done -d key=$ADMIN_KEY
```

Rejected or pending items are never returned as approved, and an item can only be marked done once.
