import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SeedResult } from "@/db/seed";
import { executeTool, toolDefinitions, type ToolContext } from "@/services/ai/tools";
import { findOrCreateConversation } from "@/services/conversations";
import { prisma, resetAndSeed, useMockWhatsApp } from "./helpers";

let s: SeedResult;
let ctx: ToolContext;
let n = 0;

const run = (name: string, args: Record<string, unknown> = {}, c: ToolContext = ctx) => executeTool(c, name, JSON.stringify(args));
const partId = async (sku: string, businessId = s.businessA.id) => (await prisma.part.findFirstOrThrow({ where: { businessId, sku } })).id;

async function freshConversation(businessId = s.businessA.id) {
  const actor = { kind: "system" as const, businessId, label: "test" };
  const phone = `2779000${String(++n).padStart(4, "0")}`;
  const customer = await prisma.customer.create({ data: { businessId, phone } });
  const conv = await findOrCreateConversation(actor, customer.id, phone);
  return { businessId, conversationId: conv.id } satisfies ToolContext;
}

beforeAll(async () => {
  s = await resetAndSeed();
});
beforeEach(async () => {
  useMockWhatsApp();
  ctx = await freshConversation();
});

describe("tool surface", () => {
  it("exposes the specified tools and nothing that approves, sends or runs SQL", () => {
    const names = toolDefinitions.map((t) => t.name);
    for (const required of [
      "get_customer", "create_customer", "update_customer", "get_vehicle", "create_vehicle", "search_parts", "check_part_fitment",
      "check_stock", "get_labour_rates", "create_quote", "update_quote", "get_quote", "submit_quote_for_approval",
    ]) expect(names).toContain(required);
    expect(names.filter((x) => /approve|send|sql|query|delete|price/i.test(x))).toEqual([]);
  });

  it("never accepts tenant or price arguments from the model", () => {
    for (const t of toolDefinitions) {
      const props = Object.keys((t.parameters as { properties?: Record<string, unknown> }).properties ?? {});
      expect(props.filter((p) => /^(business_?id|conversation_?id|.*price.*|discount.*|vat.*|total.*)$/i.test(p))).toEqual([]);
    }
  });

  it("returns structured errors for unknown tools, bad JSON and bad arguments instead of throwing", async () => {
    expect(await run("drop_database")).toMatchObject({ ok: false, error: "UNKNOWN_TOOL" });
    expect(await executeTool(ctx, "get_customer", "{oops")).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
    expect(await run("check_stock", { part_id: 5 })).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
    expect(await run("create_quote", { items: [{ part_id: "x", quantity: 0 }] })).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
  });
});

describe("customer and vehicle tools", () => {
  it("saves customer details on the conversation's own customer", async () => {
    expect(await run("get_customer")).toMatchObject({ missing: ["name"] });
    const r = await run("update_customer", { name: "Lerato Dlamini", email: "lerato@example.com" });
    expect(r).toMatchObject({ ok: true });
    expect(await run("get_customer")).toMatchObject({ customer: { name: "Lerato Dlamini", email: "lerato@example.com" }, missing: [] });
    expect(await run("update_customer", { email: "not-an-email" })).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
  });

  it("creates a vehicle, attaches it, then updates the same record progressively", async () => {
    const first = await run("create_vehicle", { make: "vw", model: "Golf 7" });
    expect(first).toMatchObject({ ok: true, missing_for_parts_search: ["year"] });
    const vehicleId = (first.vehicle as { id: string }).id;
    const second = await run("create_vehicle", { make: "Volkswagen", model: "Golf 7", year: 2016, engine: "1.4 TSI" });
    expect((second.vehicle as { id: string }).id).toBe(vehicleId);
    expect(second.missing_for_parts_search).toEqual([]);
    expect(await prisma.vehicle.count({ where: { customer: { conversations: { some: { id: ctx.conversationId } } } } })).toBe(1);
    expect(await run("get_vehicle")).toMatchObject({ vehicle: { year: 2016, engine: "1.4 TSI" } });
  });

  it("rejects an invalid VIN with an explanation and keeps the other details", async () => {
    const r = await run("create_vehicle", { make: "Volkswagen", model: "Polo", year: 2015, vin: "ABC123" });
    expect(r.ok).toBe(true);
    expect(String(r.vin_error)).toMatch(/17/);
    expect((r.vehicle as { vin: string | null }).vin).toBeNull();
    const good = await run("update_vehicle", { vin: "wvwzzzauzgw123456" });
    expect(good.vin_error).toBeNull();
    expect((good.vehicle as { vin: string }).vin).toBe("WVWZZZAUZGW123456");
  });
});

describe("parts search tools", () => {
  it("requires the vehicle before searching", async () => {
    const r = await run("search_parts", { query: "front brake pads" });
    expect(r).toMatchObject({ ok: false, vehicle_known: false });
  });

  it("returns only fitting, in-stock-aware options from the database", async () => {
    await run("create_vehicle", { make: "Volkswagen", model: "Golf 7", year: 2016, engine: "1.4 TSI" });
    const r = await run("search_parts", { query: "front brake pads" });
    expect(r.ok).toBe(true);
    const skus = (r.results as { sku: string }[]).map((x) => x.sku);
    expect(skus).toEqual(expect.arrayContaining(["BSH-BP-G7F", "BRM-BP-G7F", "GEN-BP-G7F"]));
    expect(skus).not.toContain("BSH-BP-HLX");
    expect(skus).not.toContain("BSH-BP-F30");
    expect((r.results as { label: string | null }[]).every((x) => x.label !== "Best")).toBe(true);
  });

  it("does not leak another business's inventory", async () => {
    await run("create_vehicle", { make: "Volkswagen", model: "Golf 7", year: 2016 });
    const r = await run("search_parts", { query: "brake pads" });
    expect((r.results as { sku: string }[]).some((x) => x.sku.startsWith("CAP-"))).toBe(false);
    expect(await run("check_stock", { part_id: await partId("CAP-BP-001", s.businessB.id) })).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });

  it("checks fitment and stock", async () => {
    await run("create_vehicle", { make: "Volkswagen", model: "Golf 7", year: 2016, engine: "1.4 TSI" });
    expect(await run("check_part_fitment", { part_id: await partId("BSH-BP-G7F") })).toMatchObject({ fits: true });
    expect(await run("check_part_fitment", { part_id: await partId("BSH-BP-HLX") })).toMatchObject({ fits: false, status: "CONFLICT" });
    expect(await run("check_stock", { part_id: await partId("BSH-BP-G7F"), quantity: 2 })).toMatchObject({ enough_stock: true });
    expect(await run("check_stock", { part_id: await partId("BSH-BP-RGR") })).toMatchObject({ in_stock: 0, enough_stock: false });
    expect(await run("check_stock", { part_id: await partId("VLO-CLT-G7"), quantity: 5 })).toMatchObject({ enough_stock: false });
  });

  it("lists labour rates for the business", async () => {
    const r = await run("get_labour_rates");
    const names = (r.labour_rates as { name: string }[]).map((x) => x.name);
    expect(names).toContain("Brake replacement");
  });
});

describe("quote tools", () => {
  beforeEach(async () => {
    await run("update_customer", { name: "Quote Tester" });
    await run("create_vehicle", { make: "Volkswagen", model: "Golf 7", year: 2016, engine: "1.4 TSI" });
  });

  it("refuses to quote without an identified vehicle", async () => {
    const other = await freshConversation();
    const r = await run("create_quote", { items: [{ part_id: await partId("BSH-BP-G7F"), quantity: 1 }] }, other);
    expect(r).toMatchObject({ ok: false });
    expect(String(r.message)).toMatch(/MISSING_VEHICLE/);
  });

  it("creates a DRAFT with server-side prices and submits it for approval, never sending it", async () => {
    const wa = useMockWhatsApp();
    const rate = await prisma.labourRate.findFirstOrThrow({ where: { businessId: s.businessA.id, name: "Brake replacement" } });
    const created = await run("create_quote", {
      items: [{ part_id: await partId("BSH-BP-G7F"), quantity: 1 }],
      labour: [{ labour_rate_id: rate.id }],
      notes_for_business: "Customer says brakes squeal.",
    });
    expect(created).toMatchObject({ ok: true, status: "DRAFT", sent_to_customer: false });
    const q = await prisma.quotation.findFirstOrThrow({ where: { conversationId: ctx.conversationId }, include: { items: true } });
    expect(q.source).toBe("AI");
    expect(Number(q.items[0].unitPrice)).toBe(850);
    expect(q.internalNotes).toMatch(/squeal/);
    expect(Number(q.total)).toBe(1667.5);

    const submitted = await run("submit_quote_for_approval");
    expect(submitted).toMatchObject({ ok: true, status: "PENDING_APPROVAL", awaiting_business_approval: true, sent_to_customer: false });
    expect(wa.outbox).toHaveLength(0);
    const after = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    expect(after.status).toBe("PENDING_APPROVAL");
    expect(after.sentAt).toBeNull();
    expect(after.approvedById).toBeNull();
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: ctx.conversationId } });
    expect(conv.status).toBe("QUOTE_APPROVAL");
  });

  it("locks the quote once submitted and refuses AI edits", async () => {
    await run("create_quote", { items: [{ part_id: await partId("BSH-BP-G7F"), quantity: 1 }] });
    await run("submit_quote_for_approval");
    const r = await run("update_quote", { items: [{ part_id: await partId("BRM-BP-G7F"), quantity: 1 }] });
    expect(r).toMatchObject({ ok: false, error: "QUOTE_LOCKED" });
  });

  it("can update a draft before submission", async () => {
    await run("create_quote", { items: [{ part_id: await partId("BSH-BP-G7F"), quantity: 1 }] });
    const r = await run("update_quote", { items: [{ part_id: await partId("BSH-BP-G7F"), quantity: 2 }, { part_id: await partId("MNH-OF-VAG"), quantity: 1 }] });
    expect(r).toMatchObject({ ok: true });
    expect((r.parts as unknown[]).length).toBe(2);
    expect(await run("get_quote")).toMatchObject({ ok: true, status: "DRAFT" });
  });

  it("rejects a part that does not fit, is out of stock or exceeds stock", async () => {
    const conflict = await run("create_quote", { items: [{ part_id: await partId("BSH-BP-HLX"), quantity: 1 }] });
    expect(String(conflict.message)).toMatch(/FITMENT_CONFLICT/);

    await run("update_vehicle", { make: "Ford", model: "Ranger", year: 2018 });
    const oos = await run("create_quote", { items: [{ part_id: await partId("BSH-BP-RGR"), quantity: 1 }] });
    expect(String(oos.message)).toMatch(/OUT_OF_STOCK/);

    const ctx2 = await freshConversation();
    await run("create_vehicle", { make: "Volkswagen", model: "Golf 7", year: 2016, engine: "1.4 TSI", transmission: "Manual" }, ctx2);
    const insufficient = await run("create_quote", { items: [{ part_id: await partId("VLO-CLT-G7"), quantity: 5 }] }, ctx2);
    expect(String(insufficient.message)).toMatch(/INSUFFICIENT_STOCK/);
    expect(await prisma.quotation.count({ where: { conversationId: { in: [ctx.conversationId, ctx2.conversationId] } } })).toBe(0);
  });

  it("ignores attempts to set prices, discounts or VAT", async () => {
    const r = await run("create_quote", { items: [{ part_id: await partId("BSH-BP-G7F"), quantity: 1, unit_price: 1, discount: 800, vat_rate: 0 }] });
    expect(r.ok).toBe(true);
    const item = await prisma.quotationItem.findFirstOrThrow({ where: { quotation: { conversationId: ctx.conversationId } } });
    expect(Number(item.unitPrice)).toBe(850);
    expect(Number(item.discount)).toBe(0);
    expect(Number(item.vatRate)).toBe(15);
  });

  it("cannot quote another business's part", async () => {
    const r = await run("create_quote", { items: [{ part_id: await partId("CAP-BP-001", s.businessB.id), quantity: 1 }] });
    expect(r).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });

  it("never changes base inventory prices", async () => {
    const before = await prisma.part.findMany({ where: { businessId: s.businessA.id }, select: { id: true, sellingPrice: true, quantityInStock: true } });
    await run("create_quote", { items: [{ part_id: await partId("BSH-BP-G7F"), quantity: 1 }] });
    await run("submit_quote_for_approval");
    const after = await prisma.part.findMany({ where: { businessId: s.businessA.id }, select: { id: true, sellingPrice: true, quantityInStock: true } });
    expect(after).toEqual(before);
  });
});

describe("part requests and handoff", () => {
  it("logs a part request lead once and de-duplicates repeats", async () => {
    await run("create_vehicle", { make: "Mazda", model: "3", year: 2012 });
    const a = await run("request_part", { description: "Front brake pads", notes: "customer wants OEM" });
    expect(a).toMatchObject({ ok: true, already_logged: false });
    const b = await run("request_part", { description: "Front brake pads" });
    expect(b).toMatchObject({ ok: true, already_logged: true });
    const rows = await prisma.partRequest.findMany({ where: { conversationId: ctx.conversationId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("OPEN");
  });

  it("flags a human handoff that stops AI replies", async () => {
    const r = await run("request_human_handoff", { reason: "Customer is upset about a previous repair" });
    expect(r.ok).toBe(true);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: ctx.conversationId } });
    expect(conv).toMatchObject({ status: "HUMAN_REQUIRED", handler: "HUMAN" });
    expect(conv.humanReason).toMatch(/upset/);
  });
});
