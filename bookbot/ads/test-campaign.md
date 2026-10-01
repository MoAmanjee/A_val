# Demand test: barbershops (budget R300-R500 total, needs owner approval)

Goal: find out whether barbershop owners will start a free trial. Not to make money yet.

## Setup
- Platform: Facebook / Instagram ads
- Audience: South Africa, one city (e.g. Johannesburg), ages 20-50, interests: barbershop, hairdressing, small business owner
- Landing page: `/barbers`
- Duration: 5 days, about R60-R100 per day
- Placements: Instagram feed and Facebook feed only

## Ad copy variants
1. Headline: "Empty chair because of no-shows?"
   Text: "Get a booking link for your barbershop and automatic WhatsApp reminders. Free for 14 days."
2. Headline: "Stop answering 'are you free at 3?'"
   Text: "Clients book their own slot from your Instagram bio. You just cut hair. Try BookBot free."
3. Headline: "One no-show costs more than BookBot."
   Text: "R299/month. Booking page + WhatsApp reminders for barbershops. 14-day free trial."

## Decision rule (set before spending)
- Count free-trial sign-ups after R500 of spend.
- 10 or more sign-ups: the message works. Ask the owner to approve the next R1000 and focus on converting trials to paying.
- 3-9 sign-ups: change the headline or niche and run one more R300 test.
- Fewer than 3 sign-ups: stop. The niche or product doesn't pull, and no more money should be spent on it.

## Request the spend through the owner approval queue
```bash
curl -X POST $BASE/admin/approvals -d key=$ADMIN_KEY -d kind=ad_spend \
  -d description="Barbershop demand test, Facebook/Instagram, 5 days" -d amount_zar=500
```
