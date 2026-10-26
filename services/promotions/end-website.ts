import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";

/**
 * Take a website special down immediately. WhatsApp messages already sent stay
 * as they are — Meta does not support recalling them.
 */
export async function endWebsitePromotion(storeId: string, promotionId: string, now = new Date()) {
  const promo = await db.promotion.findFirst({
    where: { id: promotionId, storeId },
    select: { id: true, showOnWebsite: true, menuItemId: true, endsAt: true },
  });
  if (!promo) throw new NotFoundError("Promotion");
  if (!promo.showOnWebsite) {
    throw new Error("That promotion is not on the website.");
  }

  const alreadyEnded = promo.endsAt != null && promo.endsAt.getTime() <= now.getTime();
  if (alreadyEnded) {
    return { id: promo.id, alreadyEnded: true as const };
  }

  await db.$transaction(async (tx) => {
    await tx.promotion.update({
      where: { id: promo.id },
      data: {
        // Keep showOnWebsite so it still appears as "Ended" in the kitchen list.
        endsAt: now,
      },
    });
    if (promo.menuItemId) {
      await tx.menuItem.updateMany({
        where: { id: promo.menuItemId, storeId },
        data: { available: false, active: false },
      });
    }
  });

  return { id: promo.id, alreadyEnded: false as const };
}
