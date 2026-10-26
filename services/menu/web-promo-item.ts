import { db } from "@/lib/db";
import type { MenuItem } from "@/app/order/types";
import { itemImage } from "@/services/menu/web-images";
import { activeWebsitePromoWhere } from "@/services/promotions/schedule";

/** Load a priced website special as a storefront menu item (promo category is otherwise hidden). */
export async function loadOrderableWebsitePromo(promoId: string): Promise<MenuItem | null> {
  const promo = await db.promotion.findFirst({
    where: {
      id: promoId,
      menuItemId: { not: null },
      priceCents: { not: null },
      ...activeWebsitePromoWhere(),
    },
    include: {
      menuItem: {
        include: {
          category: true,
          modifierLinks: {
            orderBy: { sortOrder: "asc" },
            include: {
              group: {
                include: {
                  options: { where: { available: true }, orderBy: { sortOrder: "asc" } },
                },
              },
            },
          },
        },
      },
    },
  });

  const item = promo?.menuItem;
  if (!item || !item.active || !item.available) return null;

  return {
    id: item.id,
    name: item.name,
    shortName: item.shortName,
    description: item.description ?? promo.body,
    priceCents: item.priceCents,
    mealUpgradeCents: item.mealUpgradeCents,
    mealDescription: item.mealDescription,
    imageUrl: promo.imagePath
      ? `/${promo.imagePath.replace(/^\//, "")}`
      : itemImage(item.name, item.category.name),
    modifiers: item.modifierLinks.map((link) => ({
      groupId: link.group.id,
      name: link.group.name,
      prompt: link.group.prompt,
      selection: link.group.selection,
      minSelect: link.group.minSelect,
      maxSelect: link.group.maxSelect,
      required: link.required,
      scope: link.scope,
      options: link.group.options.map((opt) => ({
        id: opt.id,
        name: opt.name,
        description: opt.description,
        priceDeltaCents: opt.priceDeltaCents,
      })),
    })),
  };
}
