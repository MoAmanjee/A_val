import { describe, expect, it, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    promotion: { update },
    menuItem: { updateMany },
  }),
);

vi.mock("@/lib/db", () => ({
  db: {
    promotion: { findFirst, update },
    menuItem: { updateMany },
    $transaction: transaction,
  },
}));

describe("endWebsitePromotion", () => {
  beforeEach(() => {
    findFirst.mockReset();
    update.mockReset();
    updateMany.mockReset();
    transaction.mockClear();
  });

  it("ends an active website promo and disables its menu item", async () => {
    findFirst.mockResolvedValue({
      id: "promo_1",
      showOnWebsite: true,
      menuItemId: "item_1",
      endsAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    update.mockResolvedValue({});
    updateMany.mockResolvedValue({ count: 1 });

    const { endWebsitePromotion } = await import("@/services/promotions/end-website");
    const now = new Date("2026-10-26T10:00:00.000Z");
    const result = await endWebsitePromotion("store_1", "promo_1", now);

    expect(result).toEqual({ id: "promo_1", alreadyEnded: false });
    expect(update).toHaveBeenCalledWith({
      where: { id: "promo_1" },
      data: { endsAt: now },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "item_1", storeId: "store_1" },
      data: { available: false, active: false },
    });
  });

  it("is a no-op when the promo already ended", async () => {
    findFirst.mockResolvedValue({
      id: "promo_2",
      showOnWebsite: true,
      menuItemId: null,
      endsAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    const { endWebsitePromotion } = await import("@/services/promotions/end-website");
    const result = await endWebsitePromotion("store_1", "promo_2", new Date("2026-10-26T10:00:00.000Z"));
    expect(result.alreadyEnded).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
  });
});
