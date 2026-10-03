# Mochachos Potchefstroom CBD — WhatsApp ordering

WhatsApp agent for one shop: **Mochachos Potchefstroom CBD**, 17 Nelson Mandela Drive, Potchefstroom.

A customer messages the branch number. The bot sends the menu pictures, then walks the order one question at a time: flavour (Lemon & Herb, Mild, Hot, Extra Hot, or Dynamite), whether it should be a meal, which drink, and anything else. It shows the total and waits for a clear yes before the kitchen sees it. The kitchen screen accepts the ticket and later marks it ready. Both of those steps message the customer.

The menu is the 2026 Mochachos RSA board, stored in Postgres. Change a price or mark something sold out in the database and the next message uses the new figure. The bot does not invent prices.

## What a customer can do

- Say hi, or ask for the menu, and get the two menu pages plus a tappable list.
- Order in plain language ("hot quarter chicken meal with a Coke") when `OPENAI_API_KEY` is set.
- Order with buttons only, even with no AI key.
- Confirm, change, or cancel. "Ja", "yebo", and "sharp" count as yes. "Yes but make it hot" does not place the order.
- Ask when it will be ready, or cancel while the kitchen has not started (and for a few minutes after it accepts).
- Ask for a person. The chat is then left for staff.

Collection only. Pay at the till with cash, card, or SnapScan. There is no delivery and no in-chat payment.

## Kitchen screen

Open `/kitchen` and enter `KITCHEN_PIN` (default `1234` until you change it).

- **New** — Accept, with how many minutes it will take. The customer is told that time.
- **Cooking** — Ready to collect. The customer is told to come through.
- **Ready** — Collected.
- **Cannot make it** — the customer is told the order was cancelled and nothing will be charged.

## Run it locally

Postgres 16 via Docker:

```bash
cp .env.example .env
# For local tries, set WHATSAPP_DRIVER=mock
npm run local
```

`npm run local` starts the database, applies migrations, seeds the Potch menu, and runs the app on port 3000.

Without Docker, point `DATABASE_URL` at your own Postgres, then:

```bash
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

The kitchen is at http://localhost:3000/kitchen. The webhook is `GET` and `POST` `/api/webhooks/whatsapp`.

## Connect the real WhatsApp number

1. In Meta, create a WhatsApp Business app and add the Potchefstroom number.
2. Set `WHATSAPP_DRIVER=cloud`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, and a long `WHATSAPP_VERIFY_TOKEN`.
3. Set `APP_URL` to the public HTTPS origin (an ngrok URL is enough for a trial).
4. In Meta, set the callback URL to `$APP_URL/api/webhooks/whatsapp` and the verify token to the same `WHATSAPP_VERIFY_TOKEN`.
5. Put that phone number id on the store row (the seed uses a placeholder, `100000000000001`, until you do). Re-seed or update `stores.whatsappPhoneNumberId`.

Inbound webhooks are checked with `X-Hub-Signature-256`. The same message id is stored once, so Meta retries do not place a second order.

Menu pictures are uploaded to Meta and the media id is cached. If the upload cannot run, the bot sends a link under `APP_URL` instead, which only works when that origin is public.

## Menu pictures

`public/menu/mochachos-menu-1.jpg`, `mochachos-menu-2.jpg`, and `mochachos-menu.pdf` are rendered from the seeded 2026 prices so the bot has something to send. They are not a scan of the printed board. Drop a real photo or the original PDF in those paths (keep the file names, or edit the image rows in `db/menu.ts`) and re-seed.

Regenerate the stand-in boards with `python3 scripts/render-menu-boards.py` after exporting `public/menu/menu.json` from `db/menu.ts`. The script's header has the export command.

## Things still to confirm with the shop

These were not on the menu PDF, so they are placeholders:

- Trading hours (Sun 11:00–20:00, Mon–Thu 10:00–21:00, Fri–Sat 10:00–22:00).
- The branch phone number (`null` until you set it).
- `posCode` values. They are labels for a future till export, not the shop's real PLU codes.
- Prep time defaults to 20 minutes. The kitchen's Accept button replaces that for each order.

There is no halaal answer on file. If a customer asks, the assistant is told to hand the chat to staff rather than guess.

## Tests

```bash
npm test
npm run typecheck
```

The tests cover prices against the combo board, the yes/no lexicon, button ids, menu paging, and the flavour → meal → drink order. They do not need Postgres.
