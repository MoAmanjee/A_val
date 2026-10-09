import { PrismaClient } from "@prisma/client";
import { seedStore } from "../db/seed";

const prisma = new PrismaClient();

async function main() {
  const result = await seedStore(prisma);
  const items = await prisma.menuItem.count({ where: { storeId: result.storeId } });
  console.log(`Seeded Machachos Potchefstroom (${result.storeId}) with ${items} menu items.`);
  console.log(`WhatsApp phone number id: ${result.phoneNumberId}`);
  console.log("Kitchen screen: http://localhost:3000/kitchen");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
