import type { Metadata } from "next";
import { db } from "@/lib/db";
import { categoryImage, itemImage, ORDER_BRAND } from "@/services/menu/web-images";
import { DELIVERY_ENABLED } from "@/services/orders/features";
import { env } from "@/lib/env";
import { OrderStorefront } from "./OrderStorefront";
import type { OrderMenuPayload } from "./types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order online · Mochachos Potch CBD",
  description: "Photo menu with Zee Flavours, meals, and kitchen notes — same kitchen as WhatsApp.",
};

async function loadMenu(): Promise<OrderMenuPayload> {
  const store = await db.store.findFirst({
    orderBy: { createdAt: "asc" },
    include: {
      categories: {
        where: { active: true },
        orderBy: { sortOrder: "asc" },
        include: {
          items: {
            where: { active: true },
            orderBy: { sortOrder: "asc" },
            include: {
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
      },
    },
  });

  if (!store) {
    throw new Error("Store not seeded");
  }

  const categories = store.categories
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      description: cat.description,
      imageUrl: categoryImage(cat.name),
      items: cat.items
        .filter((item) => item.available)
        .map((item) => ({
          id: item.id,
          name: item.name,
          shortName: item.shortName,
          description: item.description,
          priceCents: item.priceCents,
          mealUpgradeCents: item.mealUpgradeCents,
          mealDescription: item.mealDescription,
          imageUrl: itemImage(item.name, cat.name),
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
        })),
    }))
    .filter((cat) => cat.items.length > 0);

  return {
    store: {
      id: store.id,
      name: store.tradingName ?? store.name,
      city: store.city,
      addressLine: store.addressLine,
      acceptingOrders: store.acceptingOrders,
      pausedReason: store.pausedReason,
      defaultPrepMinutes: store.defaultPrepMinutes,
      deliveryEnabled: DELIVERY_ENABLED,
      deliveryFeeCents: store.deliveryFeeCents,
      whatsappDisplay: store.phone,
    },
    brand: ORDER_BRAND,
    orderUrl: `${env.appUrl.replace(/\/$/, "")}/order`,
    categories,
  };
}

export default async function OrderPage() {
  const menu = await loadMenu();
  return <OrderStorefront initial={menu} />;
}
