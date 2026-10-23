import type { Business, PrismaClient, User } from "@prisma/client";
import { hashPassword } from "@/services/auth";
import {
  approveQuotation,
  cancelQuotation,
  createQuotation,
  respondToQuotation,
  submitForApproval,
} from "@/services/quotes/service";
import { MockWhatsAppService, setWhatsAppService } from "@/services/whatsapp";
import type { UserActor } from "@/types/actor";

export const DEMO_PASSWORD = "Password123!";

interface PartSeed {
  sku: string;
  partNumber: string;
  name: string;
  description?: string;
  category: string;
  manufacturer: string;
  cost: number;
  price: number;
  stock: number;
  min?: number;
  location?: string;
  universal?: boolean;
  recommended?: boolean;
  fitments?: {
    make: string;
    model?: string;
    yearFrom?: number;
    yearTo?: number;
    variant?: string;
    engine?: string;
    engineCode?: string;
    fuelType?: string;
    transmission?: string;
    notes?: string;
  }[];
}

const GOLF7_FRONT_PADS = [
  { make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020, engine: "1.4 TSI", fuelType: "Petrol", notes: "Front axle, 288mm discs" },
  { make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020, engine: "1.2 TSI", fuelType: "Petrol", notes: "Front axle, 288mm discs" },
];

const PARTS_A: PartSeed[] = [
  { sku: "BSH-BP-G7F", partNumber: "BSH-0986-G7F", name: "Front Brake Pad Set", description: "Bosch front brake pads", category: "Brake Pads", manufacturer: "Bosch", cost: 520, price: 850, stock: 12, min: 4, location: "A1-03", fitments: GOLF7_FRONT_PADS },
  { sku: "BRM-BP-G7F", partNumber: "BRM-P85-G7F", name: "Front Brake Pad Set", description: "Brembo front brake pads", category: "Brake Pads", manufacturer: "Brembo", cost: 760, price: 1150, stock: 5, min: 3, location: "A1-04", fitments: GOLF7_FRONT_PADS },
  { sku: "GEN-BP-G7F", partNumber: "GEN-FP-1042", name: "Front Brake Pad Set", description: "Economy front brake pads", category: "Brake Pads", manufacturer: "Generic", cost: 300, price: 550, stock: 20, min: 6, location: "A1-05", fitments: GOLF7_FRONT_PADS },
  { sku: "BSH-BP-G7R", partNumber: "BSH-0986-G7R", name: "Rear Brake Pad Set", description: "Bosch rear brake pads", category: "Brake Pads", manufacturer: "Bosch", cost: 430, price: 720, stock: 8, min: 3, location: "A1-06", fitments: [{ make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020, notes: "Rear axle" }] },
  { sku: "BRM-BD-G7F", partNumber: "BRM-09-D-G7F", name: "Front Brake Disc", description: "Brembo vented front disc, sold each", category: "Brake Discs", manufacturer: "Brembo", cost: 900, price: 1400, stock: 8, min: 2, location: "A2-01", fitments: [{ make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020, engine: "1.4 TSI", notes: "288mm vented, sold each" }] },
  { sku: "BSH-BP-HLX", partNumber: "BSH-0986-HLX", name: "Front Brake Pad Set", description: "Bosch front brake pads for Hilux", category: "Brake Pads", manufacturer: "Bosch", cost: 640, price: 980, stock: 6, min: 2, location: "A1-08", fitments: [{ make: "Toyota", model: "Hilux", yearFrom: 2016, yearTo: 2022, engine: "2.8 GD-6", fuelType: "Diesel" }] },
  { sku: "BSH-BP-F30", partNumber: "BSH-0986-F30", name: "Front Brake Pad Set", description: "Bosch front brake pads for BMW F30", category: "Brake Pads", manufacturer: "Bosch", cost: 880, price: 1350, stock: 4, min: 2, location: "A1-09", fitments: [{ make: "BMW", model: "3 Series", variant: "F30", yearFrom: 2012, yearTo: 2018 }] },
  { sku: "BSH-BP-RGR", partNumber: "BSH-0986-RGR", name: "Front Brake Pad Set", description: "Bosch front brake pads for Ranger", category: "Brake Pads", manufacturer: "Bosch", cost: 590, price: 890, stock: 0, min: 2, location: "A1-10", fitments: [{ make: "Ford", model: "Ranger", yearFrom: 2012, yearTo: 2022 }] },
  { sku: "BSH-BP-P6F", partNumber: "BSH-0986-P6F", name: "Front Brake Pad Set", description: "Bosch front brake pads for Polo", category: "Brake Pads", manufacturer: "Bosch", cost: 470, price: 780, stock: 9, min: 3, location: "A1-11", fitments: [{ make: "Volkswagen", model: "Polo", yearFrom: 2010, yearTo: 2020, engine: "1.2 TSI", fuelType: "Petrol" }] },
  { sku: "MNH-OF-VAG", partNumber: "MNH-HU-7008Z", name: "Oil Filter", description: "Mann oil filter element", category: "Oil Filters", manufacturer: "Mann", cost: 85, price: 145, stock: 30, min: 10, location: "B1-01", fitments: [{ make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020, engine: "1.4 TSI" }, { make: "Volkswagen", model: "Polo", yearFrom: 2010, yearTo: 2020, engine: "1.2 TSI" }] },
  { sku: "MNH-AF-G7", partNumber: "MNH-C-27-009", name: "Air Filter", description: "Mann air filter", category: "Air Filters", manufacturer: "Mann", cost: 160, price: 290, stock: 14, min: 4, location: "B1-02", fitments: [{ make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020, engine: "1.4 TSI" }] },
  { sku: "MNH-CF-G7", partNumber: "MNH-CUK-2939", name: "Cabin Filter", description: "Mann cabin filter", category: "Cabin Filters", manufacturer: "Mann", cost: 140, price: 260, stock: 11, min: 4, location: "B1-03", fitments: [{ make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020 }] },
  { sku: "BSH-OF-HLX", partNumber: "BSH-0451-HLX", name: "Oil Filter", description: "Bosch oil filter", category: "Oil Filters", manufacturer: "Bosch", cost: 120, price: 210, stock: 16, min: 5, location: "B1-04", fitments: [{ make: "Toyota", model: "Hilux", yearFrom: 2016, yearTo: 2022, engine: "2.8 GD-6" }] },
  { sku: "CST-5W30-5L", partNumber: "CST-EDGE-5W30-5L", name: "Engine Oil 5W-30 5L", description: "Castrol Edge fully synthetic 5W-30", category: "Engine Oil", manufacturer: "Castrol", cost: 690, price: 980, stock: 18, min: 6, location: "B2-01", universal: true, recommended: true },
  { sku: "NGK-SP-TSI", partNumber: "NGK-ILKAR8L8", name: "Spark Plug Set (4)", description: "NGK iridium spark plugs, set of 4", category: "Spark Plugs", manufacturer: "NGK", cost: 420, price: 620, stock: 7, min: 3, location: "B3-01", fitments: [{ make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2018, engine: "1.4 TSI", fuelType: "Petrol" }] },
  { sku: "NGK-SP-F30", partNumber: "NGK-ILKAR7B", name: "Spark Plug Set (4)", description: "NGK spark plugs for N20 engine", category: "Spark Plugs", manufacturer: "NGK", cost: 520, price: 780, stock: 3, min: 2, location: "B3-02", fitments: [{ make: "BMW", model: "3 Series", variant: "F30", yearFrom: 2012, yearTo: 2018, engine: "2.0", fuelType: "Petrol" }] },
  { sku: "SAC-SH-G7F", partNumber: "SAC-315-G7F", name: "Front Shock Absorber", description: "Sachs front shock absorber, sold each", category: "Shock Absorbers", manufacturer: "Sachs", cost: 820, price: 1250, stock: 6, min: 2, location: "C1-01", fitments: [{ make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020, notes: "Sold each" }] },
  { sku: "SAC-SH-HLX", partNumber: "SAC-315-HLX", name: "Front Shock Absorber", description: "Sachs front shock absorber, sold each", category: "Shock Absorbers", manufacturer: "Sachs", cost: 980, price: 1500, stock: 4, min: 2, location: "C1-02", fitments: [{ make: "Toyota", model: "Hilux", yearFrom: 2016, yearTo: 2022, notes: "Sold each" }] },
  { sku: "VLE-BAT-N60", partNumber: "VLE-NS60-12V", name: "Car Battery 12V 60Ah", description: "Maintenance-free 12V 60Ah battery", category: "Batteries", manufacturer: "Willard", cost: 1150, price: 1650, stock: 5, min: 2, location: "D1-01", universal: true },
  { sku: "BSH-WIP-600", partNumber: "BSH-AEROTWIN-600", name: "Wiper Blade 600mm", description: "Bosch Aerotwin flat wiper blade", category: "Wipers", manufacturer: "Bosch", cost: 95, price: 180, stock: 25, min: 8, location: "D2-01", universal: true },
  { sku: "VLO-CLT-G7", partNumber: "VLO-826-G7M", name: "Clutch Kit", description: "Valeo 3-piece clutch kit, manual gearbox only", category: "Clutch Kits", manufacturer: "Valeo", cost: 2900, price: 4200, stock: 2, min: 1, location: "E1-01", fitments: [{ make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020, engine: "1.4 TSI", transmission: "Manual", notes: "Manual gearbox only (not DSG)" }] },
];

const PARTS_B: PartSeed[] = [
  { sku: "CAP-BP-001", partNumber: "CAP-BP-001", name: "Front Brake Pad Set", category: "Brake Pads", manufacturer: "Ferodo", cost: 400, price: 690, stock: 10, fitments: [{ make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020 }] },
  { sku: "CAP-OF-001", partNumber: "CAP-OF-001", name: "Oil Filter", category: "Oil Filters", manufacturer: "Mahle", cost: 70, price: 130, stock: 40, fitments: [{ make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020 }] },
  { sku: "CAP-WIP-001", partNumber: "CAP-WIP-001", name: "Wiper Blade 550mm", category: "Wipers", manufacturer: "Valeo", cost: 80, price: 150, stock: 12, universal: true },
];

async function seedParts(db: PrismaClient, businessId: string, parts: PartSeed[]) {
  for (const p of parts) {
    await db.part.create({
      data: {
        businessId,
        sku: p.sku,
        partNumber: p.partNumber,
        name: p.name,
        description: p.description,
        category: p.category,
        manufacturer: p.manufacturer,
        costPrice: p.cost.toFixed(2),
        sellingPrice: p.price.toFixed(2),
        quantityInStock: p.stock,
        minimumStockLevel: p.min ?? 2,
        location: p.location,
        universal: p.universal ?? false,
        recommended: p.recommended ?? false,
        fitments: p.fitments ? { create: p.fitments } : undefined,
      },
    });
  }
}

export interface SeedResult {
  businessA: Business;
  businessB: Business;
  adminA: User;
  staffA: User;
  adminB: User;
  actorA: UserActor;
  actorB: UserActor;
  customers: { john: { id: string }; priya: { id: string }; thabo: { id: string } };
}

/**
 * Development seed: two independent businesses (to exercise tenant isolation), 21 parts with
 * fitments, 5 vehicles, labour rates, 3 customers, conversations and sample quotations.
 * Sample quotations are created through the real quote services so totals/audit are genuine.
 */
export async function seedDemo(db: PrismaClient): Promise<SeedResult> {
  setWhatsAppService(new MockWhatsAppService());
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const businessA = await db.business.create({
    data: {
      name: "Elite Car Spares (Pty) Ltd",
      tradingName: "Elite Car Spares",
      registrationNumber: "2015/123456/07",
      vatNumber: "4123456789",
      address: "12 Workshop Road\nBraamfontein, Johannesburg\n2001",
      phone: "+27 11 555 0100",
      email: "quotes@elitecarspares.example",
      whatsappNumber: "27115550100",
      whatsappPhoneNumberId: "DEMO_PHONE_ID_ELITE",
      quotePrefix: "ECS",
      vatRate: "15.00",
      quoteValidityDays: 7,
      optionDisplayMode: "ALL",
      paymentDetails: "Bank: Example Bank\nAccount name: Elite Car Spares\nAccount no: 1234567890\nBranch code: 000000\nReference: your quote number",
      termsAndConditions:
        "1. Prices are valid until the date shown and are subject to stock availability.\n2. Parts fitted by Elite Car Spares carry a 6 month warranty; supplied-only parts carry the manufacturer warranty.\n3. Electrical parts are non-returnable once fitted.\n4. Payment is due on completion of work.",
    },
  });
  const businessB = await db.business.create({
    data: {
      name: "Cape Auto Parts",
      address: "88 Main Road, Cape Town",
      phone: "+27 21 555 0200",
      email: "info@capeauto.example",
      whatsappPhoneNumberId: "DEMO_PHONE_ID_CAPE",
      quotePrefix: "CAP",
      optionDisplayMode: "CHEAPEST",
    },
  });

  const adminA = await db.user.create({ data: { businessId: businessA.id, name: "Anele Dlamini", email: "admin@elitecarspares.test", passwordHash, role: "BUSINESS_ADMIN" } });
  const staffA = await db.user.create({ data: { businessId: businessA.id, name: "Sipho Nkosi", email: "staff@elitecarspares.test", passwordHash, role: "STAFF" } });
  await db.user.create({ data: { businessId: businessA.id, name: "Platform Owner", email: "owner@autoquote.test", passwordHash, role: "SUPER_ADMIN" } });
  const adminB = await db.user.create({ data: { businessId: businessB.id, name: "Cape Admin", email: "admin@capeauto.test", passwordHash, role: "BUSINESS_ADMIN" } });

  await seedParts(db, businessA.id, PARTS_A);
  await seedParts(db, businessB.id, PARTS_B);

  for (const l of [
    { name: "Brake replacement", description: "Replace brake pads/discs on one axle", fixedPrice: "600.00", defaultHours: "1.00" },
    { name: "Oil service", description: "Engine oil and filter change", hourlyRate: "480.00", defaultHours: "1.00" },
    { name: "Diagnostic inspection", description: "Workshop inspection to confirm the fault", fixedPrice: "550.00", defaultHours: "1.00" },
    { name: "General labour", description: "Workshop labour per hour", hourlyRate: "480.00", defaultHours: "1.00" },
    { name: "Shock absorber replacement", description: "Replace a pair of shock absorbers", hourlyRate: "480.00", defaultHours: "1.50" },
    { name: "Battery fitment", description: "Test and fit battery", fixedPrice: "150.00", defaultHours: "1.00" },
  ]) {
    await db.labourRate.create({ data: { businessId: businessA.id, ...l } });
  }
  await db.labourRate.create({ data: { businessId: businessB.id, name: "General labour", hourlyRate: "420.00" } });

  const mk = (name: string, phone: string, email?: string) =>
    db.customer.create({ data: { businessId: businessA.id, name, phone, email } });
  const john = await mk("John Smith", "27821234567", "john.smith@example.com");
  const priya = await mk("Priya Naidoo", "27835551234");
  const thabo = await mk("Thabo Mokoena", "27729876543", "thabo@example.com");
  await db.customer.create({ data: { businessId: businessB.id, name: "Cape Customer", phone: "27825550001" } });

  const golf = await db.vehicle.create({ data: { businessId: businessA.id, customerId: john.id, vin: "WVWZZZAUZGW123456", registrationNumber: "CA 123-456", make: "Volkswagen", model: "Golf 7", year: 2016, variant: "Comfortline", engine: "1.4 TSI", engineSize: "1.4", fuelType: "Petrol", transmission: "Manual", mileage: 84000 } });
  const polo = await db.vehicle.create({ data: { businessId: businessA.id, customerId: priya.id, make: "Volkswagen", model: "Polo", year: 2017, variant: "Trendline", engine: "1.2 TSI", engineSize: "1.2", fuelType: "Petrol", transmission: "Manual" } });
  const hilux = await db.vehicle.create({ data: { businessId: businessA.id, customerId: thabo.id, registrationNumber: "GP 55 TT GP", make: "Toyota", model: "Hilux", year: 2018, variant: "Raider", engine: "2.8 GD-6", engineSize: "2.8", fuelType: "Diesel", transmission: "Automatic", mileage: 120500 } });
  await db.vehicle.create({ data: { businessId: businessA.id, make: "BMW", model: "3 Series", year: 2015, variant: "F30 320i", engine: "2.0", engineSize: "2.0", fuelType: "Petrol", transmission: "Automatic" } });
  await db.vehicle.create({ data: { businessId: businessA.id, make: "Ford", model: "Ranger", year: 2019, variant: "XLT", engine: "2.2 TDCi", engineSize: "2.2", fuelType: "Diesel", transmission: "Manual" } });

  // ---- Conversations -------------------------------------------------------------
  const ago = (min: number) => new Date(Date.now() - min * 60_000);
  const convJohn = await db.conversation.create({ data: { businessId: businessA.id, customerId: john.id, vehicleId: golf.id, whatsappNumber: john.phone, status: "WAITING_FOR_CUSTOMER", startedAt: ago(300), lastMessageAt: ago(240) } });
  const convPriya = await db.conversation.create({ data: { businessId: businessA.id, customerId: priya.id, vehicleId: polo.id, whatsappNumber: priya.phone, status: "QUOTE_APPROVAL", startedAt: ago(90), lastMessageAt: ago(45), unreadCount: 2 } });
  const convThabo = await db.conversation.create({
    data: { businessId: businessA.id, customerId: thabo.id, vehicleId: hilux.id, whatsappNumber: thabo.phone, status: "HUMAN_REQUIRED", handler: "HUMAN", humanRequestedAt: ago(20), humanReason: 'Customer said: "Can I speak to someone?"', startedAt: ago(60), lastMessageAt: ago(20), unreadCount: 1 },
  });

  const say = (conversationId: string, who: "C" | "A", content: string, minutesAgo: number) =>
    db.message.create({
      data: {
        conversationId,
        direction: who === "C" ? "INBOUND" : "OUTBOUND",
        sender: who === "C" ? "CUSTOMER" : "AI",
        content,
        deliveryStatus: who === "C" ? "RECEIVED" : "DELIVERED",
        createdAt: ago(minutesAgo),
      },
    });
  await say(convJohn.id, "C", "Hi I need brake pads for my Golf", 300);
  await say(convJohn.id, "A", "Sure 👍 I can help with that. What year is your Golf?", 299);
  await say(convJohn.id, "C", "2016", 298);
  await say(convJohn.id, "A", "Thanks. Is it the Golf 7 1.4 TSI?", 297);
  await say(convJohn.id, "C", "Yes", 296);
  await say(convJohn.id, "A", "Perfect. If you have the VIN, please send it through so I can confirm the exact parts.", 295);
  await say(convJohn.id, "C", "VIN: WVWZZZAUZGW123456", 294);
  await say(convJohn.id, "A", "Thanks John. We have Bosch, Brembo and economy options for the front pads. Should I ask the team to prepare a quote with fitting?", 293);
  await say(convJohn.id, "C", "Yes please, the Bosch ones with fitting", 292);
  await say(convJohn.id, "A", "Done. I've passed this to the team to review, and they'll send your quotation here shortly.", 291);

  await say(convPriya.id, "C", "Hello, my Polo makes a grinding noise when I brake", 90);
  await say(convPriya.id, "A", "That sounds like it could be related to the braking system. I can check available parts, but the vehicle should be inspected before replacement is confirmed. What year is the Polo?", 89);
  await say(convPriya.id, "C", "2017 1.2 TSI. I think it needs front pads", 85);
  await say(convPriya.id, "A", "Thanks Priya. I've put together a request for front brake pads plus a brake inspection, and passed it to the team to review. They'll send your quotation here shortly.", 84);
  await say(convPriya.id, "C", "Great, how long will it take?", 46);
  await say(convPriya.id, "C", "Also is it possible to drop the car off tomorrow?", 45);

  await say(convThabo.id, "C", "I need shocks for my Hilux", 61);
  await say(convThabo.id, "A", "Sure, what year is the Hilux and which engine does it have?", 60);
  await say(convThabo.id, "C", "Can I speak to someone?", 20);
  await db.message.create({ data: { conversationId: convThabo.id, direction: "OUTBOUND", sender: "SYSTEM", messageType: "NOTE", content: 'Customer requested human assistance: Customer said: "Can I speak to someone?"', deliveryStatus: "SENT", createdAt: ago(20) } });

  await db.partRequest.create({ data: { businessId: businessA.id, customerId: thabo.id, vehicleId: hilux.id, conversationId: convThabo.id, description: "Front lower control arm (left) - Toyota Hilux 2018 2.8 GD-6", notes: "Not stocked. Customer asked about availability." } });

  // ---- Sample quotations (through the real services) -----------------------------------
  setWhatsAppService(new MockWhatsAppService());

  const actorA: UserActor = { kind: "user", userId: adminA.id, businessId: businessA.id, role: "BUSINESS_ADMIN", name: adminA.name };
  const actorB: UserActor = { kind: "user", userId: adminB.id, businessId: businessB.id, role: "BUSINESS_ADMIN", name: adminB.name };
  const partBySku = async (sku: string) => (await db.part.findFirstOrThrow({ where: { businessId: businessA.id, sku } })).id;
  const labourByName = async (name: string) => (await db.labourRate.findFirstOrThrow({ where: { businessId: businessA.id, name } })).id;

  // 1. Sent quote for John (Bosch pads + brake replacement).
  const q1 = await createQuotation(actorA, {
    customerId: john.id, vehicleId: golf.id, conversationId: convJohn.id, source: "AI",
    items: [{ partId: await partBySku("BSH-BP-G7F"), quantity: 1, fitmentConfidence: "EXACT" }],
    labour: [{ labourId: await labourByName("Brake replacement") }],
    internalNotes: "Customer asked for Bosch front pads with fitting.",
  });
  await submitForApproval({ kind: "ai", businessId: businessA.id, conversationId: convJohn.id }, q1.id);
  await approveQuotation(actorA, q1.id, { send: true });

  // 2. Older accepted quote for John (service).
  const q2 = await createQuotation(actorA, {
    customerId: john.id, vehicleId: golf.id,
    items: [{ partId: await partBySku("MNH-OF-VAG"), quantity: 1 }, { partId: await partBySku("CST-5W30-5L"), quantity: 1 }],
    labour: [{ labourId: await labourByName("Oil service") }],
  });
  await approveQuotation(actorA, q2.id, { send: true });
  await respondToQuotation(actorA, q2.id, "ACCEPTED");

  // 3. AI-created quote awaiting approval (Priya's Polo).
  const q3 = await createQuotation(actorA, {
    customerId: priya.id, vehicleId: polo.id, conversationId: convPriya.id, source: "AI",
    items: [{ partId: await partBySku("BSH-BP-P6F"), quantity: 1, fitmentConfidence: "EXACT" }],
    labour: [{ labourId: await labourByName("Diagnostic inspection") }, { labourId: await labourByName("Brake replacement") }],
    internalNotes: "Customer reports a grinding noise when braking. Not a confirmed diagnosis - inspect before replacing.",
  });
  await submitForApproval({ kind: "ai", businessId: businessA.id, conversationId: convPriya.id }, q3.id);

  // 4. Draft for Thabo (Hilux shocks).
  await createQuotation(actorA, {
    customerId: thabo.id, vehicleId: hilux.id,
    items: [{ partId: await partBySku("SAC-SH-HLX"), quantity: 2 }],
    labour: [{ labourId: await labourByName("Shock absorber replacement") }],
  });

  // 5. Cancelled quote.
  const q5 = await createQuotation(actorA, {
    customerId: john.id, vehicleId: golf.id,
    items: [{ partId: await partBySku("VLO-CLT-G7"), quantity: 1 }],
    labour: [{ labourId: await labourByName("General labour"), hours: 4 }],
  });
  await cancelQuotation(actorA, q5.id, "Customer decided to get a second opinion");

  setWhatsAppService(null);
  return { businessA, businessB, adminA, staffA, adminB, actorA, actorB, customers: { john, priya, thabo } };
}
