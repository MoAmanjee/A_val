import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SeedResult } from "@/db/seed";
import { quoteBody } from "@/lib/schemas";
import { buildQuotePdf } from "@/services/pdf/quotePdf";
import {
  approveQuotation, buildPdfData, cancelQuotation, createQuotation, duplicateQuotation, getQuotationFull, getQuotationPdf,
  listQuotations, respondToQuotation, sendQuotation, submitForApproval, updateQuotation,
} from "@/services/quotes/service";
import { getStorage } from "@/services/storage";
import { WhatsAppError } from "@/services/whatsapp";
import type { AiActor } from "@/types/actor";
import { prisma, resetAndSeed, useMockWhatsApp } from "./helpers";
import { toNumber } from "@/utils/money";

let s: SeedResult;
let wa: ReturnType<typeof useMockWhatsApp>;

const part = (sku: string, businessId = s.businessA.id) => prisma.part.findFirstOrThrow({ where: { businessId, sku } });
const rate = (name: string) => prisma.labourRate.findFirstOrThrow({ where: { businessId: s.businessA.id, name } });

async function newDraft() {
  const golf = await prisma.vehicle.findFirstOrThrow({ where: { businessId: s.businessA.id, model: "Golf 7" } });
  return createQuotation(s.actorA, {
    customerId: s.customers.john.id,
    vehicleId: golf.id,
    items: [
      { partId: (await part("BSH-BP-G7F")).id, quantity: 1 },
      { partId: (await part("BRM-BD-G7F")).id, quantity: 2 },
    ],
    labour: [{ labourId: (await rate("Brake replacement")).id }],
  });
}

beforeAll(async () => {
  s = await resetAndSeed();
});
beforeEach(() => {
  wa = useMockWhatsApp();
});

describe("quote creation and totals", () => {
  it("prices lines from inventory and computes totals on the server", async () => {
    const q = await newDraft();
    // 850 + 2x1400 = 3650 parts, 600 labour => 4250 + 15% VAT = 4887.50
    expect(q.status).toBe("DRAFT");
    expect(q.items.map((i) => toNumber(i.unitPrice))).toEqual([850, 1400]);
    expect(toNumber(q.subtotal)).toBe(3650);
    expect(toNumber(q.labourTotal)).toBe(600);
    expect(toNumber(q.vat)).toBe(637.5);
    expect(toNumber(q.total)).toBe(4887.5);
    expect(q.quoteNumber).toMatch(/^ECS-\d{4}-\d{6}$/);
    expect(q.validUntil!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it("issues sequential numbers per business with the configured prefix", async () => {
    const a1 = await newDraft();
    const a2 = await newDraft();
    expect(Number(a2.quoteNumber.split("-")[2])).toBe(Number(a1.quoteNumber.split("-")[2]) + 1);
    const cust = await prisma.customer.findFirstOrThrow({ where: { businessId: s.businessB.id } });
    const b1 = await createQuotation(s.actorB, { customerId: cust.id, items: [{ partId: (await part("CAP-OF-001", s.businessB.id)).id, quantity: 1 }] });
    expect(b1.quoteNumber).toMatch(/^CAP-\d{4}-000001$/);
  });

  it("ignores totals sent by the client", () => {
    const parsed = quoteBody.parse({ items: [{ quantity: 1, unitPrice: 10, total: 999999, vat: 5 }], subtotal: 1, total: 1, vat: 0 });
    expect(parsed).not.toHaveProperty("total");
    expect(parsed).not.toHaveProperty("subtotal");
    expect(parsed.items![0]).not.toHaveProperty("total");
  });

  it("supports custom line items and configurable VAT / VAT-inclusive pricing", async () => {
    const q = await createQuotation(s.actorA, {
      customerId: s.customers.john.id,
      items: [{ description: "Supplied-only special order", quantity: 1, unitPrice: 115 }],
      vatRate: 20,
      pricesIncludeVat: true,
    });
    expect(toNumber(q.total)).toBe(115);
    expect(toNumber(q.vat)).toBe(19.17);
    expect(q.items[0].partId).toBeNull();
  });

  it("rejects invalid pricing", async () => {
    await expect(createQuotation(s.actorA, { customerId: s.customers.john.id, items: [{ description: "x", quantity: 1, unitPrice: -5 }] })).rejects.toThrow(/negative/);
    await expect(createQuotation(s.actorA, { customerId: s.customers.john.id, items: [{ description: "x", quantity: 1, unitPrice: 5, discount: 10 }] })).rejects.toThrow(/discount/);
    await expect(createQuotation(s.actorA, { customerId: s.customers.john.id, items: [{ description: "x", quantity: 0, unitPrice: 5 }] })).rejects.toThrow(/quantity/);
    await expect(createQuotation(s.actorA, { customerId: s.customers.john.id, items: [{ description: "no price", quantity: 1 }] })).rejects.toThrow(/price is required/);
  });
});

describe("business editing", () => {
  it("recalculates immediately when the business changes price, quantity, discount", async () => {
    const q = await newDraft();
    const pads = q.items[0];
    const updated = await updateQuotation(s.actorA, q.id, {
      items: [{ id: pads.id, quantity: 1, unitPrice: 700 }, { id: q.items[1].id, quantity: 2, discount: 100 }],
    });
    expect(toNumber(updated.items[0].unitPrice)).toBe(700);
    expect(toNumber(updated.items[1].total)).toBe(2700);
    // (700 + 2800 + 600 - 100) = 4000 net, VAT 15% on (700 + 2700 + 600) = 600, total = 4100 + 600 - ... compute: subtotal 3500 + labour 600 - discount 100 + vat 600
    expect(toNumber(updated.subtotal)).toBe(3500);
    expect(toNumber(updated.discount)).toBe(100);
    expect(toNumber(updated.vat)).toBe(600);
    expect(toNumber(updated.total)).toBe(4600);
  });

  it("keeps existing prices when a line is saved without a price (no silent re-pricing)", async () => {
    const q = await newDraft();
    const custom = await updateQuotation(s.actorA, q.id, { items: [{ id: q.items[0].id, quantity: 1, unitPrice: 777 }, { id: q.items[1].id, quantity: 2 }] });
    await prisma.part.update({ where: { id: q.items[0].partId! }, data: { sellingPrice: "999.00" } });
    const again = await updateQuotation(s.actorA, q.id, { items: custom.items.map((i) => ({ id: i.id, quantity: toNumber(i.quantity) + 0 })) });
    expect(toNumber(again.items[0].unitPrice)).toBe(777);
    await prisma.part.update({ where: { id: q.items[0].partId! }, data: { sellingPrice: "850.00" } });
  });

  it("can add, remove and swap parts, labour and custom items", async () => {
    const q = await newDraft();
    const updated = await updateQuotation(s.actorA, q.id, {
      items: [
        { id: q.items[0].id, partId: (await part("BRM-BP-G7F")).id, quantity: 1, unitPrice: 1100 },
        { description: "Brake fluid top-up", quantity: 1, unitPrice: 90 },
      ],
      labour: [{ description: "Extra workshop time", hours: 0.5, unitPrice: 480 }],
    });
    expect(updated.items).toHaveLength(2);
    expect(updated.items[0].partId).toBe((await part("BRM-BP-G7F")).id);
    expect(updated.labour).toHaveLength(1);
    expect(toNumber(updated.labour[0].total)).toBe(240);
  });

  it("records who changed prices, added and removed lines in the audit log", async () => {
    const q = await newDraft();
    await updateQuotation(s.actorA, q.id, {
      items: [{ id: q.items[0].id, quantity: 1, unitPrice: 700 }, { description: "Extra", quantity: 1, unitPrice: 10 }],
    });
    const logs = await prisma.auditLog.findMany({ where: { entityType: "Quotation", entityId: q.id }, orderBy: { createdAt: "asc" } });
    const actions = logs.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["quote.create", "quote.price_change", "quote.item_add", "quote.item_remove"]));
    const price = logs.find((l) => l.action === "quote.price_change")!;
    expect(price.userId).toBe(s.adminA.id);
    expect(JSON.stringify(price.details)).toContain("700");
  });

  it("rejects unknown line ids and lines from other quotes", async () => {
    const q = await newDraft();
    const other = await newDraft();
    await expect(updateQuotation(s.actorA, q.id, { items: [{ id: other.items[0].id, quantity: 1 }] })).rejects.toThrow(/unknown line/);
  });
});

describe("approval workflow", () => {
  it("the AI can submit for approval but can never approve or send", async () => {
    const conv = await prisma.conversation.findFirstOrThrow({ where: { businessId: s.businessA.id, customerId: s.customers.thabo.id } });
    const ai: AiActor = { kind: "ai", businessId: s.businessA.id, conversationId: conv.id };
    const q = await createQuotation(ai, {
      customerId: s.customers.thabo.id, conversationId: conv.id,
      items: [{ partId: (await part("SAC-SH-HLX")).id, quantity: 2, unitPrice: 1 }],
    });
    expect(q.source).toBe("AI");
    expect(toNumber(q.items[0].unitPrice)).toBe(1500);
    const submitted = await submitForApproval(ai, q.id);
    expect(submitted.status).toBe("PENDING_APPROVAL");
    await expect(approveQuotation(ai as never, q.id)).rejects.toThrow(/Only business users/);
    await expect(sendQuotation(ai as never, q.id)).rejects.toThrow(/Only business users/);
    expect(wa.outbox).toHaveLength(0);
    // The AI can no longer edit after submission.
    await expect(updateQuotation(ai, q.id, { items: [{ partId: (await part("SAC-SH-HLX")).id, quantity: 1 }] })).rejects.toThrow(/cannot edit/);
    // Nothing was sent to the customer.
    expect((await getQuotationFull(s.businessA.id, q.id)).sentAt).toBeNull();
  });

  it("the AI cannot override prices, discounts or add custom items", async () => {
    const conv = await prisma.conversation.findFirstOrThrow({ where: { businessId: s.businessA.id, customerId: s.customers.john.id } });
    const ai: AiActor = { kind: "ai", businessId: s.businessA.id, conversationId: conv.id };
    await prisma.quotation.updateMany({ where: { conversationId: conv.id, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] } }, data: { status: "CANCELLED" } });
    await expect(createQuotation(ai, { customerId: conv.customerId, conversationId: conv.id, items: [{ description: "Free stuff", quantity: 1, unitPrice: 0 }] })).rejects.toThrow(/inventory/);
    const q = await createQuotation(ai, {
      customerId: conv.customerId, conversationId: conv.id,
      items: [{ partId: (await part("MNH-OF-VAG")).id, quantity: 1, unitPrice: 1, discount: 100, vatRate: 0 }],
    });
    expect(toNumber(q.items[0].unitPrice)).toBe(145);
    expect(toNumber(q.items[0].discount)).toBe(0);
    expect(toNumber(q.items[0].vatRate)).toBe(15);
  });

  it("prevents duplicate open quotations for one conversation", async () => {
    const conv = await prisma.conversation.findFirstOrThrow({ where: { businessId: s.businessA.id, customerId: s.customers.priya.id } });
    await expect(createQuotation(s.actorA, { customerId: conv.customerId, conversationId: conv.id, items: [{ description: "x", quantity: 1, unitPrice: 1 }] })).rejects.toThrow(/already open/);
  });

  it("APPROVE & SEND: locks pricing, stores a PDF, sends it on WhatsApp and marks SENT", async () => {
    const q = await newDraft();
    const res = await approveQuotation(s.actorA, q.id, { send: true });
    expect(res.sent).toBe(true);
    const done = res.quotation;
    expect(done.status).toBe("SENT");
    expect(done.approvedById).toBe(s.adminA.id);
    expect(done.approvedAt).toBeTruthy();
    expect(done.sentAt).toBeTruthy();
    expect(done.whatsappMessageId).toMatch(/^wamid\./);
    expect(done.sendError).toBeNull();
    expect(done.pdfKey).toContain(`${s.businessA.id}/quotes/`);

    const stored = await getStorage().get(done.pdfKey!);
    expect(stored!.data.subarray(0, 5).toString()).toBe("%PDF-");

    expect(wa.outbox).toHaveLength(1);
    const out = wa.outbox[0];
    expect(out).toMatchObject({ kind: "document", to: s.customers.john ? "27821234567" : "" });
    expect(out.filename).toBe(`${done.quoteNumber}.pdf`);
    expect(out.caption).toContain("Hi John 👋");
    expect(out.caption).toContain("2016 Volkswagen Golf 7");
    expect(out.caption).toContain(`Quote: ${done.quoteNumber}`);
    expect(out.caption).toContain("Total: R4,887.50");

    const audits = (await prisma.auditLog.findMany({ where: { entityId: q.id } })).map((a) => a.action);
    expect(audits).toEqual(expect.arrayContaining(["quote.approve", "quote.send"]));
    const msg = await prisma.message.findFirst({ where: { whatsappMessageId: done.whatsappMessageId! } });
    expect(msg).toMatchObject({ messageType: "DOCUMENT", direction: "OUTBOUND", deliveryStatus: "SENT" });
  });

  it("locks the quotation after approval", async () => {
    const q = await newDraft();
    await approveQuotation(s.actorA, q.id, { send: false });
    const locked = await getQuotationFull(s.businessA.id, q.id);
    expect(locked.status).toBe("APPROVED");
    await expect(updateQuotation(s.actorA, q.id, { items: [{ id: q.items[0].id, quantity: 1, unitPrice: 1 }] })).rejects.toThrow(/locked/);
    await expect(approveQuotation(s.actorA, q.id, { send: false })).rejects.toThrow(/cannot be approved/);
  });

  it("does NOT mark SENT when WhatsApp fails, shows the error and allows retry", async () => {
    const q = await newDraft();
    wa.failNext = new WhatsAppError("WhatsApp API error (131047): Re-engagement message", false);
    const res = await approveQuotation(s.actorA, q.id, { send: true });
    expect(res.sent).toBe(false);
    expect(res.error).toContain("131047");
    expect(res.quotation.status).toBe("APPROVED");
    expect(res.quotation.sendError).toContain("131047");
    expect(res.quotation.sentAt).toBeNull();
    expect(res.quotation.approvedById).toBe(s.adminA.id);
    expect(wa.outbox).toHaveLength(0);

    const retry = await sendQuotation(s.actorA, q.id);
    expect(retry.sent).toBe(true);
    expect(retry.quotation.status).toBe("SENT");
    expect(retry.quotation.sendError).toBeNull();
    expect(wa.outbox).toHaveLength(1);
    const audits = (await prisma.auditLog.findMany({ where: { entityId: q.id } })).map((a) => a.action);
    expect(audits).toEqual(expect.arrayContaining(["quote.send_failed", "quote.send"]));
  });

  it("re-approving through the retry path reuses the same stored PDF", async () => {
    const q = await newDraft();
    wa.failNext = new WhatsAppError("boom", true);
    const first = await approveQuotation(s.actorA, q.id, { send: true });
    const key = first.quotation.pdfKey;
    const second = await approveQuotation(s.actorA, q.id, { send: true });
    expect(second.sent).toBe(true);
    expect(second.quotation.pdfKey).toBe(key);
  });

  it("supports resending a sent quotation", async () => {
    const q = await newDraft();
    await approveQuotation(s.actorA, q.id);
    const r = await sendQuotation(s.actorA, q.id);
    expect(r.sent).toBe(true);
    expect(wa.outbox).toHaveLength(2);
    expect((await prisma.auditLog.findMany({ where: { entityId: q.id, action: "quote.resend" } })).length).toBe(1);
  });

  it("handles concurrent approvals safely (exactly one wins)", async () => {
    const q = await newDraft();
    const results = await Promise.allSettled([approveQuotation(s.actorA, q.id, { send: false }), approveQuotation(s.actorA, q.id, { send: false })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("refuses to approve an empty quotation or one with an expired validity", async () => {
    const empty = await createQuotation(s.actorA, { customerId: s.customers.john.id });
    await expect(approveQuotation(s.actorA, empty.id)).rejects.toThrow(/no lines/);
    const old = await newDraft();
    await updateQuotation(s.actorA, old.id, { validUntil: new Date(Date.now() - 5 * 86_400_000) });
    await expect(approveQuotation(s.actorA, old.id)).rejects.toThrow(/validity date/);
  });

  it("returns stock warnings without blocking the business", async () => {
    const q = await createQuotation(s.actorA, { customerId: s.customers.john.id, items: [{ partId: (await part("BSH-BP-RGR")).id, quantity: 1 }] });
    const res = await approveQuotation(s.actorA, q.id, { send: false });
    expect(res.warnings.join(" ")).toContain("only 0 in stock");
  });

  it("recomputes totals at approval even if stored totals were tampered with", async () => {
    const q = await newDraft();
    await prisma.quotation.update({ where: { id: q.id }, data: { total: "1.00", vat: "0.00" } });
    const res = await approveQuotation(s.actorA, q.id, { send: false });
    expect(toNumber(res.quotation.total)).toBe(4887.5);
  });
});

describe("lifecycle", () => {
  it("cancels, duplicates and records accept/decline", async () => {
    const q = await newDraft();
    const dup = await duplicateQuotation(s.actorA, q.id);
    expect(dup.status).toBe("DRAFT");
    expect(dup.quoteNumber).not.toBe(q.quoteNumber);
    expect(dup.items).toHaveLength(2);
    expect(toNumber(dup.total)).toBe(toNumber(q.total));

    const cancelled = await cancelQuotation(s.actorA, q.id, "customer changed mind");
    expect(cancelled.status).toBe("CANCELLED");
    await expect(cancelQuotation(s.actorA, q.id)).rejects.toThrow(/cannot be cancelled/);
    expect((await prisma.auditLog.findFirst({ where: { entityId: q.id, action: "quote.cancel" } }))?.summary).toContain("customer changed mind");

    await expect(respondToQuotation(s.actorA, dup.id, "ACCEPTED")).rejects.toThrow(/sent to the customer/);
    await approveQuotation(s.actorA, dup.id);
    expect((await respondToQuotation(s.actorA, dup.id, "ACCEPTED")).status).toBe("ACCEPTED");
  });

  it("marks sent quotations past their validity as EXPIRED and supports filters", async () => {
    const q = await newDraft();
    await approveQuotation(s.actorA, q.id);
    await prisma.quotation.update({ where: { id: q.id }, data: { validUntil: new Date(Date.now() - 86_400_000) } });
    const list = await listQuotations(s.businessA.id, { q: q.quoteNumber });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].status).toBe("EXPIRED");

    expect((await listQuotations(s.businessA.id, { status: "PENDING_APPROVAL" })).items.every((i) => i.status === "PENDING_APPROVAL")).toBe(true);
    expect((await listQuotations(s.businessA.id, { customer: "priya" })).items.every((i) => i.customer.name === "Priya Naidoo")).toBe(true);
    expect((await listQuotations(s.businessA.id, { vehicle: "Hilux" })).items.length).toBeGreaterThan(0);
    const future = await listQuotations(s.businessA.id, { dateFrom: new Date(Date.now() + 86_400_000) });
    expect(future.total).toBe(0);
  });
});

describe("PDF generation", () => {
  it("generates a valid, compact professional PDF for a typical quote", async () => {
    const q = await newDraft();
    const business = await prisma.business.findUniqueOrThrow({ where: { id: s.businessA.id } });
    const pdf = await buildQuotePdf(await buildPdfData(await getQuotationFull(s.businessA.id, q.id), business));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(3000);
    const pages = pdf.toString("latin1").match(/\/Type \/Page\b/g)!.length;
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(pages).toBeLessThanOrEqual(2);
  });

  it("paginates long quotations", async () => {
    const q = await createQuotation(s.actorA, {
      customerId: s.customers.john.id,
      items: Array.from({ length: 45 }, (_, i) => ({ description: `Custom part line number ${i + 1} with a reasonably long description to test wrapping behaviour`, quantity: 1, unitPrice: 10 + i })),
    });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: s.businessA.id } });
    const pdf = await buildQuotePdf(await buildPdfData(await getQuotationFull(s.businessA.id, q.id), business));
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
  });

  it("renders quotes without a vehicle, logo, or optional fields", async () => {
    const q = await createQuotation(s.actorB, { customerId: (await prisma.customer.findFirstOrThrow({ where: { businessId: s.businessB.id } })).id, items: [{ description: "Thing", quantity: 1, unitPrice: 10 }] });
    const business = await prisma.business.findUniqueOrThrow({ where: { id: s.businessB.id } });
    const pdf = await buildQuotePdf(await buildPdfData(await getQuotationFull(s.businessB.id, q.id), business));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("serves a draft preview for unapproved quotes and the stored file once approved", async () => {
    const q = await newDraft();
    const preview = await getQuotationPdf(s.businessA.id, q.id);
    expect(preview.preview).toBe(true);
    expect(preview.filename).toContain("draft");
    await approveQuotation(s.actorA, q.id, { send: false });
    const final = await getQuotationPdf(s.businessA.id, q.id);
    expect(final.preview).toBe(false);
  });
});
