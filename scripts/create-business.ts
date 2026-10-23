/**
 * Onboard a new business (tenant) with its first admin user.
 *
 *   npx tsx scripts/create-business.ts --name "Cape Auto Parts" --prefix CAP \
 *     --admin-name "Jane Doe" --admin-email jane@example.com --password 'a-long-password' \
 *     [--phone-number-id 1234567890] [--vat 15] [--currency-symbol R]
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../services/auth";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("name");
  const email = arg("admin-email")?.trim().toLowerCase();
  const adminName = arg("admin-name") ?? "Admin";
  const password = arg("password");
  if (!name || !email || !password) {
    console.error("Usage: create-business --name <business> --admin-email <email> --password <10+ chars> [--admin-name <name>] [--prefix QT] [--phone-number-id <id>] [--vat 15] [--currency-symbol R]");
    process.exit(1);
  }
  if (password.length < 10) throw new Error("Password must be at least 10 characters");

  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email } })) throw new Error(`A user with email ${email} already exists`);
    const phoneNumberId = arg("phone-number-id");
    if (phoneNumberId && (await prisma.business.findUnique({ where: { whatsappPhoneNumberId: phoneNumberId } }))) {
      throw new Error("That WhatsApp phone number id is already connected to another business");
    }
    const business = await prisma.business.create({
      data: {
        name,
        quotePrefix: (arg("prefix") ?? "QT").toUpperCase().slice(0, 10),
        vatRate: arg("vat") ?? "15",
        currencySymbol: arg("currency-symbol") ?? "R",
        whatsappPhoneNumberId: phoneNumberId,
        users: { create: { name: adminName, email, role: "BUSINESS_ADMIN", passwordHash: await hashPassword(password) } },
      },
    });
    console.log(`Created business "${business.name}" (${business.id}) with admin ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
