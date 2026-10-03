import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isDecisive, rankByName, type Ranked } from "@/services/menu/matching";

export * from "@/services/menu/matching";

/**
 * Reading the menu. The database is the source of truth at runtime, so a price
 * change or a sold-out toggle made on the kitchen side is reflected in the next
 * message the bot sends.
 */

export const MENU_ITEM_SELECT = {
  id: true,
  name: true,
  shortName: true,
  description: true,
  priceCents: true,
  mealUpgradeCents: true,
  posCode: true,
  available: true,
  soldOutNote: true,
  categoryId: true,
} satisfies Prisma.MenuItemSelect;

export type MenuItemView = Prisma.MenuItemGetPayload<{ select: typeof MENU_ITEM_SELECT }>;

export async function getCategories(storeId: string) {
  return db.menuCategory.findMany({
    where: { storeId, active: true, items: { some: { active: true, available: true } } },
    orderBy: { sortOrder: "asc" },
  });
}

export async function getCategoryItems(storeId: string, categoryId: string) {
  const category = await db.menuCategory.findFirst({ where: { id: categoryId, storeId, active: true } });
  if (!category) return null;
  const items = await db.menuItem.findMany({
    where: { categoryId, storeId, active: true },
    orderBy: { sortOrder: "asc" },
    select: MENU_ITEM_SELECT,
  });
  return { category, items };
}

export async function getFullMenu(storeId: string) {
  return db.menuCategory.findMany({
    where: { storeId, active: true },
    orderBy: { sortOrder: "asc" },
    include: { items: { where: { active: true }, orderBy: { sortOrder: "asc" }, select: MENU_ITEM_SELECT } },
  });
}

export interface MenuSearchResult {
  matches: Ranked<MenuItemView>[];
  /** True when the top match is clearly what the customer meant. */
  decisive: boolean;
}

/** Find menu items by whatever the customer typed. */
export async function searchMenuItems(storeId: string, query: string, limit = 5): Promise<MenuSearchResult> {
  const items = await db.menuItem.findMany({ where: { storeId, active: true }, select: MENU_ITEM_SELECT });
  const ranked = rankByName(query, items, (i) => i.name);
  // An exact-ish match on a sold-out item is still the right match to report:
  // the customer needs to be told it is sold out, not offered something else.
  return { matches: ranked.slice(0, limit), decisive: isDecisive(ranked) };
}

export async function getMenuItem(storeId: string, menuItemId: string) {
  return db.menuItem.findFirst({
    where: { id: menuItemId, storeId, active: true },
    include: { category: true, modifierLinks: { orderBy: { sortOrder: "asc" }, include: { group: { include: { options: { orderBy: { sortOrder: "asc" } } } } } } },
  });
}

export async function getModifierGroups(storeId: string) {
  return db.modifierGroup.findMany({
    where: { storeId },
    orderBy: { sortOrder: "asc" },
    include: { options: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function getStoreFaqs(storeId: string) {
  return db.faqEntry.findMany({ where: { storeId, active: true }, orderBy: { sortOrder: "asc" } });
}
