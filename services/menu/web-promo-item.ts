import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { MenuItem, StorefrontSpecial } from "@/app/order/types";
import { ORDER_BRAND, itemImage } from "@/services/menu/web-images";
import { activeWebsitePromoWhere, formatScheduleLabel } from "@/services/promotions/schedule";

const promoInclude = {
  menuItem: {
    include: {
      category: true,
      modifierLinks: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          group: {
            include: {
              options: { where: { available: true }, orderBy: { sortOrder: "asc" as const } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PromotionInclude;

type PromoWithItem = Prisma.PromotionGetPayload<{ include: typeof promoInclude }>;
type PromoMenuItem = NonNullable<PromoWithItem["menuItem"]>;

function mapPromoMenuItem(item: PromoMenuItem, promo: { body: string | null; imagePath: string | null }): MenuItem {
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

/** All live website specials for the order storefront (empty → hide Specials tab). */
export async function loadActiveWebsiteSpecials(storeId: string): Promise<StorefrontSpecial[]> {
  const rows = await db.promotion.findMany({
    where: { storeId, ...activeWebsitePromoWhere() },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    take: 8,
    include: promoInclude,
  });

  return rows.map((promo) => {
    const title = promo.body?.split("\n")[0]?.trim() || promo.menuItem?.name || "Kitchen special";
    const orderable =
      promo.menuItem && promo.menuItem.active && promo.menuItem.available
        ? mapPromoMenuItem(promo.menuItem, promo)
        : null;
    return {
      id: promo.id,
      title,
      scheduleLabel: formatScheduleLabel(promo.scheduleKind, promo.startsAt, promo.endsAt),
      imageUrl: promo.imagePath
        ? `/${promo.imagePath.replace(/^\//, "")}`
        : orderable?.imageUrl || ORDER_BRAND.mark,
      priceCents: promo.priceCents ?? orderable?.priceCents ?? null,
      item: orderable,
    };
  });
}

/** Load a priced website special as a storefront menu item (promo category is otherwise hidden). */
export async function loadOrderableWebsitePromo(promoId: string): Promise<MenuItem | null> {
  const promo = await db.promotion.findFirst({
    where: {
      id: promoId,
      menuItemId: { not: null },
      priceCents: { not: null },
      ...activeWebsitePromoWhere(),
    },
    include: promoInclude,
  });

  const item = promo?.menuItem;
  if (!item || !item.active || !item.available) return null;
  return mapPromoMenuItem(item, promo);
}
