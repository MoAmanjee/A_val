/**
 * Place one collection order so the kitchen screen has something to accept.
 * Uses the mock WhatsApp driver, so nothing leaves the machine.
 *
 *   npx tsx scripts/demo-order.ts
 */
import { PrismaClient } from "@prisma/client";
import { findOrCreateConversation, findOrCreateCustomer } from "../services/conversations";
import { addItem, getOrCreateDraft, setMealUpgrade, setModifierSelection } from "../services/orders/cart";
import { confirmOrder } from "../services/orders/lifecycle";

const prisma = new PrismaClient();

async function optionId(storeId: string, groupName: string, optionName: string) {
  const group = await prisma.modifierGroup.findUniqueOrThrow({
    where: { storeId_name: { storeId, name: groupName } },
    include: { options: true },
  });
  const option = group.options.find((o) => o.name === optionName);
  if (!option) throw new Error(`No ${optionName} in ${groupName}`);
  return { groupId: group.id, optionId: option.id };
}

async function main() {
  const store = await prisma.store.findFirstOrThrow();
  const customer = await findOrCreateCustomer(store.id, "27821234567", "Thabo");
  const conversation = await findOrCreateConversation(store.id, customer.id, customer.phone);
  const item = await prisma.menuItem.findUniqueOrThrow({ where: { storeId_name: { storeId: store.id, name: "1/4 Chicken" } } });
  const draft = await getOrCreateDraft(conversation.id);
  const line = await addItem(draft.id, { menuItemId: item.id });
  const flavour = await optionId(store.id, "Zee Flavours", "Hot");
  await setModifierSelection(draft.id, line.id, flavour.groupId, [flavour.optionId]);
  await setMealUpgrade(draft.id, line.id, true);
  const drink = await optionId(store.id, "Soft drink flavour", "Coke");
  await setModifierSelection(draft.id, line.id, drink.groupId, [drink.optionId]);
  const order = await confirmOrder(draft.id);
  console.log(`Placed ${order.orderNumber} for ${customer.whatsappProfileName} — total cents ${order.totalCents}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
