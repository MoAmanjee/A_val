import { PrismaClient } from "@prisma/client";
import { DEMO_PASSWORD, seedDemo } from "../db/seed";

async function main() {
  const db = new PrismaClient();
  try {
    const existing = await db.user.findUnique({ where: { email: "admin@elitecarspares.test" } });
    if (existing) {
      console.log("Demo data already present. Run `npm run db:reset` to start over.");
      return;
    }
    await seedDemo(db);
    console.log("Seeded demo data.");
    console.log("  Business A admin : admin@elitecarspares.test");
    console.log("  Business A staff : staff@elitecarspares.test");
    console.log("  Business B admin : admin@capeauto.test");
    console.log(`  Password (all)   : ${DEMO_PASSWORD}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
