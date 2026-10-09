import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { MOCHACHOS_MENU, type MenuSeed } from "@/db/menu";
import { env } from "@/lib/env";

export interface SeedResult {
  storeId: string;
  phoneNumberId: string;
  /** Looked up by name, so tests and scripts can reference the catalogue. */
  categoryIds: Record<string, string>;
  itemIds: Record<string, string>;
  groupIds: Record<string, string>;
  /** Keyed "Group name/Option name". */
  optionIds: Record<string, string>;
}

/**
 * The branch. The phone number id is a placeholder until the real WhatsApp
 * number is connected; everything else is the actual Potch CBD shop.
 */
export const STORE_DEFAULTS = {
  name: "Mochachos Potchefstroom CBD",
  tradingName: "Mochachos Potch CBD",
  phone: null as string | null,
  addressLine: "17 Nelson Mandela Dr",
  suburb: "CBD",
  city: "Potchefstroom",
  postalCode: "2531",
  whatsappPhoneNumberId: "100000000000001",
} as const;

const TRADING_HOURS = [
  { dayOfWeek: 0, opensAt: "11:00", closesAt: "20:00" },
  { dayOfWeek: 1, opensAt: "10:00", closesAt: "21:00" },
  { dayOfWeek: 2, opensAt: "10:00", closesAt: "21:00" },
  { dayOfWeek: 3, opensAt: "10:00", closesAt: "21:00" },
  { dayOfWeek: 4, opensAt: "10:00", closesAt: "21:00" },
  { dayOfWeek: 5, opensAt: "10:00", closesAt: "22:00" },
  { dayOfWeek: 6, opensAt: "10:00", closesAt: "22:00" },
];

/**
 * Write the catalogue into the database for one store. Safe to re-run: rows are
 * matched on name, so prices and wording are updated in place and orders that
 * were already taken keep pointing at the same menu rows.
 */
export async function applyMenu(
  prisma: PrismaClient,
  storeId: string,
  menu: MenuSeed,
): Promise<Omit<SeedResult, "storeId" | "phoneNumberId">> {
  const groupIds: Record<string, string> = {};
  const optionIds: Record<string, string> = {};
  const categoryIds: Record<string, string> = {};
  const itemIds: Record<string, string> = {};

  for (const [index, g] of menu.modifierGroups.entries()) {
    const group = await prisma.modifierGroup.upsert({
      where: { storeId_name: { storeId, name: g.name } },
      create: {
        storeId,
        name: g.name,
        prompt: g.prompt,
        selection: g.selection,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        sortOrder: index,
      },
      update: { prompt: g.prompt, selection: g.selection, minSelect: g.minSelect, maxSelect: g.maxSelect, sortOrder: index },
    });
    groupIds[g.name] = group.id;

    for (const [oi, o] of g.options.entries()) {
      const option = await prisma.modifierOption.upsert({
        where: { groupId_name: { groupId: group.id, name: o.name } },
        create: {
          groupId: group.id,
          name: o.name,
          description: o.description,
          priceDeltaCents: o.priceDeltaCents ?? 0,
          posCode: o.posCode,
          sortOrder: oi,
        },
        update: { description: o.description, priceDeltaCents: o.priceDeltaCents ?? 0, posCode: o.posCode, sortOrder: oi },
      });
      optionIds[`${g.name}/${o.name}`] = option.id;
    }
  }

  for (const [ci, c] of menu.categories.entries()) {
    const category = await prisma.menuCategory.upsert({
      where: { storeId_name: { storeId, name: c.name } },
      create: { storeId, name: c.name, description: c.description, sortOrder: ci },
      update: { description: c.description, sortOrder: ci, active: true },
    });
    categoryIds[c.name] = category.id;

    for (const [ii, item] of c.items.entries()) {
      const row = await prisma.menuItem.upsert({
        where: { storeId_name: { storeId, name: item.name } },
        create: {
          storeId,
          categoryId: category.id,
          name: item.name,
          shortName: item.shortName,
          description: item.description,
          priceCents: item.priceCents,
          posCode: item.posCode,
          mealUpgradeCents: item.mealUpgradeCents ?? null,
          mealDescription: item.mealDescription ?? null,
          sortOrder: ii,
        },
        update: {
          categoryId: category.id,
          shortName: item.shortName ?? null,
          description: item.description ?? null,
          priceCents: item.priceCents,
          posCode: item.posCode,
          mealUpgradeCents: item.mealUpgradeCents ?? null,
          mealDescription: item.mealDescription ?? null,
          sortOrder: ii,
          active: true,
        },
      });
      itemIds[item.name] = row.id;

      for (const [mi, link] of (item.modifiers ?? []).entries()) {
        const groupId = groupIds[link.group];
        if (!groupId) throw new Error(`Menu item "${item.name}" references unknown modifier group "${link.group}"`);
        await prisma.menuItemModifierGroup.upsert({
          where: { menuItemId_modifierGroupId: { menuItemId: row.id, modifierGroupId: groupId } },
          create: {
            menuItemId: row.id,
            modifierGroupId: groupId,
            required: link.required ?? true,
            scope: link.scope ?? "ALWAYS",
            sortOrder: mi,
          },
          update: { required: link.required ?? true, scope: link.scope ?? "ALWAYS", sortOrder: mi },
        });
      }
    }
  }

  await prisma.faqEntry.deleteMany({ where: { storeId } });
  for (const [i, f] of menu.faqs.entries()) {
    await prisma.faqEntry.create({ data: { storeId, question: f.question, answer: f.answer, keywords: f.keywords, sortOrder: i } });
  }

  const imagePaths = new Set(menu.images.map((img) => img.filePath));
  await prisma.menuImage.updateMany({
    where: { storeId, filePath: { notIn: [...imagePaths] } },
    data: { active: false },
  });

  for (const [i, img] of menu.images.entries()) {
    const existing = await prisma.menuImage.findFirst({ where: { storeId, filePath: img.filePath } });
    const data = {
      caption: img.caption ?? null,
      isDocument: img.isDocument ?? false,
      fileName: img.fileName ?? null,
      mimeType: img.mimeType ?? "image/jpeg",
      sortOrder: i,
      active: true,
    };
    if (existing) await prisma.menuImage.update({ where: { id: existing.id }, data });
    else await prisma.menuImage.create({ data: { storeId, filePath: img.filePath, ...data } });
  }

  return { categoryIds, itemIds, groupIds, optionIds };
}

/**
 * The phone number id that should sit on the one shop row.
 * A value passed in wins, then a real id from the environment, then the id
 * already on the shop, then the placeholder. Re-seeding must not create a
 * second shop just because the placeholder was replaced.
 */
export function resolveStorePhoneId(input: { requested?: string; fromEnv?: string; existing?: string | null }): string {
  const requested = input.requested?.trim();
  if (requested) return requested;
  const fromEnv = input.fromEnv?.trim();
  if (fromEnv && fromEnv !== STORE_DEFAULTS.whatsappPhoneNumberId) return fromEnv;
  return input.existing?.trim() || STORE_DEFAULTS.whatsappPhoneNumberId;
}

export async function seedStore(prisma: PrismaClient, opts: { phoneNumberId?: string } = {}): Promise<SeedResult> {
  const kitchenPinHash = await bcrypt.hash(env.kitchenPin, 10);
  const existing = await prisma.store.findFirst({ orderBy: { createdAt: "asc" } });
  const phoneNumberId = resolveStorePhoneId({
    requested: opts.phoneNumberId,
    fromEnv: env.whatsappPhoneNumberId,
    existing: existing?.whatsappPhoneNumberId,
  });

  const store = existing
    ? await prisma.store.update({
        where: { id: existing.id },
        data: { kitchenPinHash, whatsappPhoneNumberId: phoneNumberId },
      })
    : await prisma.store.create({
        data: {
          name: STORE_DEFAULTS.name,
          tradingName: STORE_DEFAULTS.tradingName,
          phone: STORE_DEFAULTS.phone,
          addressLine: STORE_DEFAULTS.addressLine,
          suburb: STORE_DEFAULTS.suburb,
          city: STORE_DEFAULTS.city,
          postalCode: STORE_DEFAULTS.postalCode,
          whatsappPhoneNumberId: phoneNumberId,
          kitchenPinHash,
        },
      });

  for (const h of TRADING_HOURS) {
    await prisma.tradingHour.upsert({
      where: { storeId_dayOfWeek: { storeId: store.id, dayOfWeek: h.dayOfWeek } },
      create: { storeId: store.id, ...h },
      update: h,
    });
  }

  await prisma.orderSequence.upsert({
    where: { storeId: store.id },
    create: { storeId: store.id, prefix: "MP", next: 1 },
    update: {},
  });

  const menu = await applyMenu(prisma, store.id, MOCHACHOS_MENU);
  return { storeId: store.id, phoneNumberId, ...menu };
}
