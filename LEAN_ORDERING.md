# Lean ordering (fewer WhatsApp messages)

`LEAN_ORDERING` is **on** in `services/orders/features.ts`.

## What customers do less of
1. **Hi** does not auto-send the two menu pictures (tap **Menu pictures** / say “menu”, or use **Order online**).
2. **Kitchen notes** are one question for the whole order at the end, not per item.
3. After that note, the order is **placed** (no second Accept tap).
4. Typing the whole order in one message still skips spice / meal / drink questions that were already named.

## Rollback (quick)
1. Open `services/orders/features.ts`
2. Set `export const LEAN_ORDERING = false;`
3. Restart the app (`npm run dev`)

That restores per-item notes, auto menu pictures on greeting, and Confirm → Accept.
