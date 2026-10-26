import type { Metadata } from "next";
import { db } from "@/lib/db";
import { categoryImage, itemImage, ORDER_BRAND } from "@/services/menu/web-images";
import { loadOrderableWebsitePromo } from "@/services/menu/web-promo-item";
import { DELIVERY_ENABLED } from "@/services/orders/features";
import { env } from "@/lib/env";
import { OrderStorefront } from "./OrderStorefront";
import type { OrderMenuPayload } from "./types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order Mochachos Potch CBD online",
  description:
    "Order Mochachos Potchefstroom CBD for collection at 17 Nelson Mandela Dr — flame-grilled chicken, burgers, combos, and Mexican meals. Same kitchen as WhatsApp.",
  keywords: [
    "Mochachos Potch",
    "Mochachos Potchefstroom",
    "Mochachos CBD",
    "order chicken Potchefstroom",
    "Mexican chicken Potchefstroom",
  ],
  alternates: { canonical: "/order" },
};

/** Verified shop hours from the store FAQ (not the 24/7 test DB windows). */
const SHOP_HOURS_JSON_LD = [
  { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday"], opens: "10:00", closes: "21:00" },
  { "@type": "OpeningHoursSpecification", dayOfWeek: ["Friday", "Saturday"], opens: "10:00", closes: "22:00" },
  { "@type": "OpeningHoursSpecification", dayOfWeek: "Sunday", opens: "11:00", closes: "20:00" },
];

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
      webEnabled: store.webEnabled,
      billingStatus: store.billingStatus,
      suspendedReason: store.suspendedReason,
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

export default async function OrderPage({
  searchParams,
}: {
  searchParams?: Promise<{ promo?: string | string[] }>;
}) {
  const menu = await loadMenu();
  const params = (await searchParams) ?? {};
  const promoRaw = params.promo;
  const promoId = Array.isArray(promoRaw) ? promoRaw[0] : promoRaw;
  const prefillItem = promoId ? await loadOrderableWebsitePromo(promoId) : null;
  const site = env.appUrl.replace(/\/$/, "") || "https://mochachospotch.co.za";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: menu.store.name,
    image: `${site}${ORDER_BRAND.logo}`,
    url: site,
    servesCuisine: ["Mexican", "Chicken", "Burgers"],
    acceptsReservations: false,
    address: {
      "@type": "PostalAddress",
      streetAddress: menu.store.addressLine,
      addressLocality: menu.store.city,
      addressRegion: "North West",
      addressCountry: "ZA",
    },
    openingHoursSpecification: SHOP_HOURS_JSON_LD,
    hasMenu: `${site}/order`,
    potentialAction: {
      "@type": "OrderAction",
      target: `${site}/order`,
      deliveryMethod: "http://purl.org/goodrelations/v1#DeliveryModePickUp",
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <OrderStorefront initial={menu} prefillItem={prefillItem} />
    </>
  );
}
