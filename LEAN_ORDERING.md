# Lean ordering (fewer WhatsApp messages)

`LEAN_ORDERING` is **on** in `services/orders/features.ts`.

## What changed
1. **Hi** does not auto-send the two menu pictures (tap **Menu pictures** or say “menu”).
2. **Kitchen notes** are one question for the whole order at the end, not per item.
3. After that note, the order is **placed** (no second Accept tap).

## Rollback (quick)
1. Open `services/orders/features.ts`
2. Set `export const LEAN_ORDERING = false;`
3. Restart the app (`npm run dev`)

That restores per-item notes, auto menu pictures on greeting, and Confirm → Accept.

## Rollback (git)
```bash
git checkout pre-lean-ordering
# or
git checkout cursor/mochachos-whatsapp-agent-0f03
```
Tag `pre-lean-ordering` points at the last commit before lean ordering.
