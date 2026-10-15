/**
 * Delivery is commented out for now. The shop does not want it offered.
 * The questions, the address, the pin, and the kitchen price stay in the code.
 * Set this to true to turn them back on.
 */
export const DELIVERY_ENABLED = false;

/**
 * Lean ordering — fewer WhatsApp messages (cheaper Meta bill).
 *
 * When true:
 * - Menu pictures are not sent on every "hi" (only when they ask / tap Menu pictures)
 * - Leave-outs / allergies are one order-level kitchen note at the end, not per item
 * - "Confirm order" places the order after that note (no second Accept step)
 *
 * Rollback without git: set LEAN_ORDERING to false and restart the app.
 * Rollback with git: `git checkout pre-lean-ordering` (tag) or the previous branch.
 */
export const LEAN_ORDERING = true;
