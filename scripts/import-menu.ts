import { PrismaClient } from "@prisma/client";
import { seedStore } from "../db/seed";

const prisma = new PrismaClient();

seedStore(prisma)
  .then(async (result) => {
    const items = await prisma.menuItem.count({ where: { storeId: result.storeId } });
    console.log(`Imported ${items} menu items for ${result.storeId}.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
