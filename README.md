# Mochachos Potchefstroom CBD — WhatsApp ordering

WhatsApp agent for one shop: **Mochachos Potchefstroom CBD**, 17 Nelson Mandela Drive, Potchefstroom.

A customer messages the branch number. The bot sends the menu pictures. They can type the whole order in one message — item, flavour, meal, drink, and collection or delivery — and the bot only asks for what they left out. It shows the total and waits for a clear yes before the kitchen sees it. The kitchen screen accepts the ticket and later marks it ready. Both of those steps message the customer.

The menu is the 2026 Mochachos RSA board, stored in Postgres. Change a price or mark something sold out in the database and the next message uses the new figure. The bot does not invent prices.

## What a customer can do

- Say hi, or ask for the menu, and get the two menu pages plus a tappable list.
- Order in plain language ("hot quarter chicken meal with a Coke, delivery to 14 Kock Street"). That works with or without an AI key.
- Order with buttons only. On a flavour or meal question, the rest of the order can still be typed in one message.
- Confirm, change, or cancel. "Ja", "yebo", and "sharp" count as yes. "Yes but make it hot" does not place the order.
- Ask when it will be ready, or cancel while the kitchen has not started (and for a few minutes after it accepts).
- Ask for a person. The chat is then left for staff.

Collection from 17 Nelson Mandela Drive, or delivery in Potchefstroom when the customer sends a street address. The kitchen sets the delivery price, including free. That amount is added to a delivery total before the customer confirms. Pay at the till for collection, or pay the driver for delivery. The chat does not take payment.

## Kitchen screen

Open `/kitchen` and enter `KITCHEN_PIN` (default `1234` until you change it).

- **New** — Accept, with how many minutes it will take. The customer is told that time.
- **Cooking** — Ready. The customer is told to collect, or that the delivery is on its way.
- **Ready** — Collected.
- **Cannot make it** — the customer is told the order was cancelled and nothing will be charged.

## Promotions

Open `/promotions` with the same kitchen PIN. Paste a picture, type a note, or send both. It goes to customers who have messaged the shop in the last month. Older chats are skipped. The page says when WhatsApp is not connected, and in that case nothing is delivered to a phone.

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
5. Put `WHATSAPP_PHONE_NUMBER_ID` in `.env`, then start the app again. The seed copies that id onto the existing shop. Until then the row stays `100000000000001` and Meta's messages are ignored. Do not send the token or the app secret to anyone. They stay in `.env`, which is not committed.

Inbound webhooks are checked with `X-Hub-Signature-256`. The same message id is stored once, so Meta retries do not place a second order.

Menu pictures are uploaded to Meta and the media id is cached. If the upload cannot run, the bot sends a link under `APP_URL` instead, which only works when that origin is public.

## Menu pictures

The printed board is in the repo:

- `public/menu/Mochachos-RSA-Menu-2026.pdf` — the original 2026 RSA menu
- `public/menu/mochachos-menu-1.jpg` and `mochachos-menu-2.jpg` — the two pages of that PDF, which the bot sends as pictures

The item names and prices the bot charges are in `db/menu.ts`, taken from that board. Re-seed after you edit either.

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

The tests cover prices against the combo board, the yes/no lexicon, button ids, menu paging, typed orders (including delivery), and the flavour → meal → drink order. They do not need Postgres.
