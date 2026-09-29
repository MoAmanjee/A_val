import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { SeedResult } from "@/db/seed";
import { SESSION_COOKIE, signSessionToken } from "@/services/auth";
import { getConversation, listConversations } from "@/services/conversations";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "@/services/customers";
import { addFitment, adjustStock, deletePart, getPart, listFitment, listParts, updatePart } from "@/services/inventory";
import { searchParts } from "@/services/inventory/search";
import { approveQuotation, cancelQuotation, createQuotation, getQuotationFull, getQuotationPdf, listQuotations, updateQuotation } from "@/services/quotes/service";
import { getVehicle, listVehicles, updateVehicle } from "@/services/vehicles";
import { prisma, resetAndSeed, useMockWhatsApp } from "./helpers";

import { GET as quotationsGET } from "@/app/api/quotations/route";
import { GET as quotationGET } from "@/app/api/quotations/[id]/route";
import { GET as fileGET } from "@/app/api/files/[...key]/route";
import { GET as usersGET } from "@/app/api/users/route";
import { PUT as settingsPUT } from "@/app/api/settings/route";
import { POST as customersPOST } from "@/app/api/customers/route";

let s: SeedResult;
let aQuoteId: string;
let aCustomerId: string;
let aVehicleId: string;
let aPartId: string;
let aConvId: string;

async function req(url: string, userId?: string, init: { method?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "localhost:3000" };
  if (userId) headers.cookie = `${SESSION_COOKIE}=${await signSessionToken(userId)}`;
  if (init.origin) headers.origin = init.origin;
  return new NextRequest(`http://localhost:3000${url}`, { method: init.method ?? "GET", headers, body: init.body ? JSON.stringify(init.body) : undefined });
}

beforeAll(async () => {
  s = await resetAndSeed();
  useMockWhatsApp();
  aQuoteId = (await prisma.quotation.findFirstOrThrow({ where: { businessId: s.businessA.id } })).id;
  aCustomerId = s.customers.john.id;
  aVehicleId = (await prisma.vehicle.findFirstOrThrow({ where: { businessId: s.businessA.id } })).id;
  aPartId = (await prisma.part.findFirstOrThrow({ where: { businessId: s.businessA.id } })).id;
  aConvId = (await prisma.conversation.findFirstOrThrow({ where: { businessId: s.businessA.id } })).id;
});

describe("business isolation (service layer)", () => {
  it("Business B cannot read Business A records by id", async () => {
    const B = s.businessB.id;
    await expect(getCustomer(B, aCustomerId)).rejects.toThrow(/not found/);
    await expect(getVehicle(B, aVehicleId)).rejects.toThrow(/not found/);
    await expect(getPart(B, aPartId)).rejects.toThrow(/not found/);
    await expect(getQuotationFull(B, aQuoteId)).rejects.toThrow(/not found/);
    await expect(getConversation(B, aConvId)).rejects.toThrow(/not found/);
    await expect(getQuotationPdf(B, aQuoteId)).rejects.toThrow(/not found/);
  });

  it("Business B cannot modify Business A records", async () => {
    const B = s.actorB;
    await expect(updateCustomer(B, aCustomerId, { name: "Hacked" })).rejects.toThrow(/not found/);
    await expect(updateVehicle(B, aVehicleId, { make: "Hacked" })).rejects.toThrow(/not found/);
    await expect(updatePart(B, aPartId, { sellingPrice: 1 })).rejects.toThrow(/not found/);
    await expect(adjustStock(B, aPartId, { set: 0 })).rejects.toThrow(/not found/);
    await expect(deletePart(B, aPartId)).rejects.toThrow(/not found/);
    await expect(addFitment(B, aPartId, { make: "X" })).rejects.toThrow(/not found/);
    await expect(updateQuotation(B, aQuoteId, { notes: "x" })).rejects.toThrow(/not found/);
    await expect(approveQuotation(B, aQuoteId)).rejects.toThrow(/not found/);
    await expect(cancelQuotation(B, aQuoteId)).rejects.toThrow(/not found/);
    const untouched = await prisma.customer.findUniqueOrThrow({ where: { id: aCustomerId } });
    expect(untouched.name).toBe("John Smith");
  });

  it("lists and searches only return the caller's own data", async () => {
    const B = s.businessB.id;
    expect((await listCustomers(B)).items.every((c) => c.businessId === B)).toBe(true);
    expect((await listVehicles(B)).items).toHaveLength(0);
    expect((await listParts(B)).items.every((p) => p.businessId === B)).toBe(true);
    expect((await listQuotations(B)).items).toHaveLength(0);
    expect((await listConversations(B)).items).toHaveLength(0);
    expect((await listFitment(B)).items.every((f) => f.part.sku.startsWith("CAP-"))).toBe(true);
    const r = await searchParts({ businessId: B, query: "Bosch brake pads" });
    expect(r.matches.every((m) => m.part.sku.startsWith("CAP-"))).toBe(true);
  });

  it("cannot attach another business's customer, vehicle or part to a quotation", async () => {
    const B = s.actorB;
    await expect(createQuotation(B, { customerId: aCustomerId })).rejects.toThrow(/not found/);
    const ownCustomer = await prisma.customer.findFirstOrThrow({ where: { businessId: s.businessB.id } });
    await expect(createQuotation(B, { customerId: ownCustomer.id, vehicleId: aVehicleId })).rejects.toThrow(/not found/);
    await expect(createQuotation(B, { customerId: ownCustomer.id, items: [{ partId: aPartId, quantity: 1 }] })).rejects.toThrow(/not found/);
  });

  it("the same phone number can be a customer of two businesses independently", async () => {
    const c = await createCustomer(s.actorB, { name: "John (Cape)", phone: "+27 82 123 4567" });
    expect(c.businessId).toBe(s.businessB.id);
    expect(c.id).not.toBe(aCustomerId);
  });
});

describe("business isolation & auth (HTTP handlers)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await quotationsGET(await req("/api/quotations"), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for another business's quotation and only lists its own", async () => {
    const res = await quotationGET(await req(`/api/quotations/${aQuoteId}`, s.adminB.id), { params: Promise.resolve({ id: aQuoteId }) });
    expect(res.status).toBe(404);
    const list = await quotationsGET(await req("/api/quotations", s.adminB.id), { params: Promise.resolve({}) });
    expect((await list.json()).total).toBe(0);
    const own = await quotationsGET(await req("/api/quotations", s.adminA.id), { params: Promise.resolve({}) });
    expect((await own.json()).total).toBeGreaterThan(3);
  });

  it("blocks cross-tenant file access (PDFs and logos)", async () => {
    const q = await prisma.quotation.findFirstOrThrow({ where: { businessId: s.businessA.id, pdfKey: { not: null } } });
    const key = q.pdfKey!.split("/");
    const denied = await fileGET(await req(`/api/files/${q.pdfKey}`, s.adminB.id), { params: Promise.resolve({ key }) });
    expect(denied.status).toBe(403);
    const ok = await fileGET(await req(`/api/files/${q.pdfKey}`, s.adminA.id), { params: Promise.resolve({ key }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    const traversal = await fileGET(await req("/api/files/x", s.adminA.id), { params: Promise.resolve({ key: [s.businessA.id, "..", s.businessB.id, "x"] }) });
    expect(traversal.status).toBe(403);
  });

  it("enforces roles: STAFF cannot manage users or settings", async () => {
    const users = await usersGET(await req("/api/users", s.staffA.id), { params: Promise.resolve({}) });
    expect(users.status).toBe(403);
    const settings = await settingsPUT(await req("/api/settings", s.staffA.id, { method: "PUT", body: { name: "Pwned" } }), { params: Promise.resolve({}) });
    expect(settings.status).toBe(403);
    const admin = await usersGET(await req("/api/users", s.adminA.id), { params: Promise.resolve({}) });
    expect(admin.status).toBe(200);
    expect((await admin.json()).items.every((u: { email: string }) => !u.email.includes("capeauto"))).toBe(true);
  });

  it("blocks cross-origin mutations and never returns password hashes", async () => {
    const res = await customersPOST(await req("/api/customers", s.adminA.id, { method: "POST", origin: "https://evil.example", body: { phone: "27820000000" } }), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    const users = await usersGET(await req("/api/users", s.adminA.id), { params: Promise.resolve({}) });
    expect(JSON.stringify(await users.json())).not.toContain("passwordHash");
  });

  it("rejects tokens for deactivated users", async () => {
    const tmp = await prisma.user.create({ data: { businessId: s.businessA.id, name: "Temp", email: "temp@x.test", passwordHash: "x", role: "STAFF" } });
    const ok = await quotationsGET(await req("/api/quotations", tmp.id), { params: Promise.resolve({}) });
    expect(ok.status).toBe(200);
    await prisma.user.update({ where: { id: tmp.id }, data: { active: false } });
    const denied = await quotationsGET(await req("/api/quotations", tmp.id), { params: Promise.resolve({}) });
    expect(denied.status).toBe(401);
  });
});
