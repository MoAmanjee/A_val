# Dropshipping automation

A small, dependency-free Python pipeline that automates the repetitive parts of a dropshipping store:

1. **Source**: rank products from a supplier catalog CSV by margin, supplier rating and proven demand.
2. **List**: price each product to hit a target profit and create it on Shopify.
3. **Advertise**: create a Meta (Facebook/Instagram) sales campaign, ad set and ads for it, with a small test budget.
4. **Optimize**: read ad results and pause losers or scale winners, within hard spend caps.
5. **Fulfill**: forward each new paid Shopify order to your supplier, once.

Everything is **dry-run by default**. Nothing is sent, created or spent until you pass `--live`.

## Quick start

```bash
python3 -m dropship source sample_products.csv         # see what would be picked and at what price
python3 -m dropship launch sample_products.csv         # dry run: prints every API call it would make
cp .env.example .env                                   # fill in credentials
python3 -m dropship --live launch my_catalog.csv --limit 1
python3 -m dropship --live run my_catalog.csv --interval 3600   # orders + optimize + launch, hourly
python3 -m pytest
```

Commands: `source`, `launch`, `optimize`, `orders`, `run`.

## Catalog format

`sku,title,description,category,cost,shipping,image_url,supplier_rating,supplier_orders,supplier_url`
(see `sample_products.csv`). Export this from your supplier (CJdropshipping, Zendrop, AliExpress, ...) or write a small adapter that produces it.

## Safety rails

- Dry-run unless `--live`; `--live` refuses to start if credentials are missing.
- Ads are created **PAUSED** unless `ADS_START_ACTIVE=true`. Review the first ones in Ads Manager.
- Caps: `TEST_DAILY_BUDGET`, `MAX_DAILY_BUDGET_PER_PRODUCT`, `MAX_TOTAL_DAILY_BUDGET`, `MAX_ACTIVE_PRODUCTS`. Paused-at-launch campaigns count toward the caps.
- Optimizer rules: pause with zero sales once spend reaches `KILL_SPEND_MULTIPLE` x profit-per-order; pause if ROAS stays below break-even; scale budget by `SCALE_STEP` only with at least `SCALE_MIN_PURCHASES` sales and ROAS of `SCALE_ROAS_MULTIPLE` x break-even.
- Orders are tracked in `state.json` so they are never forwarded twice.
- Supplier default is `manual`: orders land in `orders_to_place.csv` for you to upload. Set `SUPPLIER_MODE=http` to POST them to a supplier API (adapt `HttpSupplier._payload` to its schema).

## What you still need to do yourself

I cannot do these for you, and the code cannot either:

- Create the Shopify store (with a payment gateway), a Meta Business account, ad account, Facebook Page and Pixel, and a supplier account. Ad accounts need your payment method.
- Create a Shopify custom app and a Meta system-user token, and put them in `.env`.
- Add legal pages (refund, shipping, privacy, terms) and set honest delivery times; slow shipping and chargebacks are the usual way dropshipping stores lose money.
- Check Meta's advertising policies for your product category. Health claims, "before/after" imagery and fake scarcity get accounts banned.
- Expect most products to lose money in testing. The caps limit the loss, they do not remove it.

## Known gaps

- The Shopify/Meta calls follow the public API docs but have not been run against live accounts here. Run a `--live` launch with one product and everything paused first, and check the result.
- Tracking numbers are not synced back from the supplier. `Shopify.mark_fulfilled` exists; wire it to your supplier's tracking feed.
- Ad creative uses the supplier image plus text copy (templates, or an LLM when `OPENAI_API_KEY` is set). There is no video or UGC generation.
- Product research is based on the catalog you provide; there is no trend scraping.
- Pricing is a flat markup to a target profit; it does not do competitor price checks.
