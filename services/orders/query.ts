import { Prisma } from "@prisma/client";

/**
 * One canonical shape for a loaded order. The modifier groups of each item come
 * along because the flow engine needs to know which questions an item still
 * owes an answer to, and the kitchen ticket needs the chosen options.
 */
export const ORDER_INCLUDE = {
  items: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      modifiers: { orderBy: { id: "asc" } },
      menuItem: {
        include: {
          category: true,
          modifierLinks: {
            orderBy: { sortOrder: "asc" },
            include: { group: { include: { options: { orderBy: { sortOrder: "asc" } } } } },
          },
        },
      },
    },
  },
  customer: true,
  store: true,
} satisfies Prisma.OrderInclude;

export type FullOrder = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
export type FullOrderItem = FullOrder["items"][number];
export type ItemModifierLink = FullOrderItem["menuItem"]["modifierLinks"][number];
