import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/services/audit";
import type { Actor } from "@/types/actor";
import { toNumber } from "@/utils/money";

export interface PartInput {
  sku: string;
  partNumber?: string | null;
  barcode?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  manufacturer?: string | null;
  costPrice?: number;
  sellingPrice?: number;
  vatRate?: number | null;
  quantityInStock?: number;
  minimumStockLevel?: number;
  location?: string | null;
  active?: boolean;
  universal?: boolean;
  recommended?: boolean;
}

const NULLABLE_TEXT = ["partNumber", "barcode", "description", "category", "manufacturer", "location"] as const;

function cleanPart(input: Partial<PartInput>): Prisma.PartUncheckedUpdateInput {
  const data: Prisma.PartUncheckedUpdateInput = {};
  if (input.sku !== undefined) {
    const sku = input.sku.trim();
    if (!sku) throw new ValidationError("SKU is required");
    data.sku = sku;
  }
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new ValidationError("Name is required");
    data.name = name;
  }
  for (const f of NULLABLE_TEXT) {
    if (input[f] !== undefined) data[f] = input[f]?.toString().trim() || null;
  }
  for (const f of ["costPrice", "sellingPrice"] as const) {
    if (input[f] !== undefined) {
      const v = input[f]!;
      if (!Number.isFinite(v) || v < 0) throw new ValidationError(`${f === "costPrice" ? "Cost" : "Selling"} price must be 0 or more`);
      data[f] = v.toFixed(2);
    }
  }
  if (input.vatRate !== undefined) {
    if (input.vatRate !== null && (input.vatRate < 0 || input.vatRate > 100)) throw new ValidationError("VAT rate must be between 0 and 100");
    data.vatRate = input.vatRate === null ? null : input.vatRate.toFixed(2);
  }
  for (const f of ["quantityInStock", "minimumStockLevel"] as const) {
    if (input[f] !== undefined) {
      if (!Number.isInteger(input[f]) || input[f]! < 0) throw new ValidationError(`${f} must be a whole number of 0 or more`);
      data[f] = input[f];
    }
  }
  for (const f of ["active", "universal", "recommended"] as const) {
    if (input[f] !== undefined) data[f] = input[f];
  }
  return data;
}

export type StockFilter = "all" | "low" | "out" | "in";

export interface ListPartsOptions {
  q?: string;
  category?: string;
  status?: "active" | "inactive" | "all";
  stock?: StockFilter;
  page?: number;
  pageSize?: number;
  sort?: "name" | "sku" | "stock" | "price" | "updated";
  dir?: "asc" | "desc";
}

function partsWhere(businessId: string, opts: ListPartsOptions): Prisma.PartWhereInput {
  const q = opts.q?.trim();
  const and: Prisma.PartWhereInput[] = [];
  if (q) {
    and.push({
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { partNumber: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { manufacturer: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (opts.category) and.push({ category: opts.category });
  const status = opts.status ?? "active";
  if (status === "active") and.push({ active: true });
  if (status === "inactive") and.push({ active: false });
  if (opts.stock === "out") and.push({ quantityInStock: { lte: 0 } });
  if (opts.stock === "in") and.push({ quantityInStock: { gt: 0 } });
  if (opts.stock === "low") {
    and.push({ quantityInStock: { lte: db.part.fields.minimumStockLevel } });
    and.push({ minimumStockLevel: { gt: 0 } });
  }
  return { businessId, AND: and };
}

export async function listParts(businessId: string, opts: ListPartsOptions = {}) {
  const pageSize = Math.min(opts.pageSize ?? 25, 200);
  const page = Math.max(opts.page ?? 1, 1);
  const sortField = { name: "name", sku: "sku", stock: "quantityInStock", price: "sellingPrice", updated: "updatedAt" }[opts.sort ?? "name"];
  const where = partsWhere(businessId, opts);
  const [items, total] = await Promise.all([
    db.part.findMany({
      where,
      orderBy: { [sortField]: opts.dir ?? (opts.sort === "updated" ? "desc" : "asc") },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { fitments: true } } },
    }),
    db.part.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function listCategories(businessId: string): Promise<string[]> {
  const rows = await db.part.findMany({
    where: { businessId, category: { not: null } },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category!).filter(Boolean);
}

export async function getPart(businessId: string, id: string) {
  const part = await db.part.findFirst({ where: { id, businessId }, include: { fitments: true } });
  if (!part) throw new NotFoundError("Part");
  return part;
}

export async function lowStockParts(businessId: string, limit = 10) {
  return db.part.findMany({
    where: {
      businessId,
      active: true,
      minimumStockLevel: { gt: 0 },
      quantityInStock: { lte: db.part.fields.minimumStockLevel },
    },
    orderBy: { quantityInStock: "asc" },
    take: limit,
  });
}

export async function createPart(actor: Actor, input: PartInput) {
  const data = cleanPart(input) as Prisma.PartUncheckedCreateInput;
  const dup = await db.part.findUnique({ where: { businessId_sku: { businessId: actor.businessId, sku: data.sku } } });
  if (dup) throw new ConflictError(`A part with SKU "${data.sku}" already exists`);
  const part = await db.part.create({ data: { ...data, businessId: actor.businessId } });
  await audit(actor, {
    action: "part.create",
    entityType: "Part",
    entityId: part.id,
    summary: `Part ${part.sku} - ${part.name} added`,
    details: { sellingPrice: toNumber(part.sellingPrice), costPrice: toNumber(part.costPrice), quantityInStock: part.quantityInStock },
  });
  return part;
}

export async function updatePart(actor: Actor, id: string, input: Partial<PartInput>) {
  const existing = await db.part.findFirst({ where: { id, businessId: actor.businessId } });
  if (!existing) throw new NotFoundError("Part");
  const data = cleanPart(input);
  if (typeof data.sku === "string" && data.sku !== existing.sku) {
    const dup = await db.part.findUnique({ where: { businessId_sku: { businessId: actor.businessId, sku: data.sku } } });
    if (dup) throw new ConflictError(`A part with SKU "${data.sku}" already exists`);
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(data)) {
    const from = (existing as Record<string, unknown>)[k];
    const same = typeof v === "string" && from !== null && typeof from === "object" ? toNumber(from as never) === Number(v) : from === v;
    if (!same) changes[k] = { from: typeof from === "object" && from !== null ? toNumber(from as never) : from, to: v };
  }
  if (Object.keys(changes).length === 0) return existing;
  const part = await db.part.update({ where: { id }, data });
  const priceChanged = "sellingPrice" in changes || "costPrice" in changes;
  await audit(actor, {
    action: priceChanged ? "part.price_change" : "part.update",
    entityType: "Part",
    entityId: id,
    summary: `Part ${part.sku} updated (${Object.keys(changes).join(", ")})`,
    details: changes as Prisma.InputJsonValue,
  });
  return part;
}

export async function deletePart(actor: Actor, id: string) {
  const existing = await db.part.findFirst({ where: { id, businessId: actor.businessId } });
  if (!existing) throw new NotFoundError("Part");
  const used = await db.quotationItem.count({ where: { partId: id } });
  if (used > 0) {
    await db.part.update({ where: { id }, data: { active: false } });
    await audit(actor, { action: "part.deactivate", entityType: "Part", entityId: id, summary: `Part ${existing.sku} deactivated (used in ${used} quotation lines)` });
    return { deleted: false, deactivated: true };
  }
  await db.part.delete({ where: { id } });
  await audit(actor, { action: "part.delete", entityType: "Part", entityId: id, summary: `Part ${existing.sku} - ${existing.name} deleted` });
  return { deleted: true, deactivated: false };
}

export async function adjustStock(actor: Actor, id: string, adj: { delta?: number; set?: number; reason?: string }) {
  if (adj.delta === undefined && adj.set === undefined) throw new ValidationError("Provide a delta or a new quantity");
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.part.findFirst({ where: { id, businessId: actor.businessId } });
    if (!existing) throw new NotFoundError("Part");
    const next = adj.set !== undefined ? adj.set : existing.quantityInStock + (adj.delta ?? 0);
    if (!Number.isInteger(next) || next < 0) throw new ValidationError("Stock cannot go below zero");
    const part = await tx.part.update({ where: { id }, data: { quantityInStock: next } });
    await audit(
      actor,
      {
        action: "part.stock_adjust",
        entityType: "Part",
        entityId: id,
        summary: `Stock for ${part.sku} changed ${existing.quantityInStock} -> ${next}${adj.reason ? ` (${adj.reason})` : ""}`,
        details: { from: existing.quantityInStock, to: next, reason: adj.reason ?? null },
      },
      tx,
    );
    return part;
  });
  return result;
}

// ---------------------------------------------------------------------------
// Fitment
// ---------------------------------------------------------------------------

export interface FitmentInput {
  make: string;
  model?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  variant?: string | null;
  engine?: string | null;
  engineCode?: string | null;
  fuelType?: string | null;
  transmission?: string | null;
  notes?: string | null;
}

function cleanFitment(input: Partial<FitmentInput>) {
  const data: Prisma.VehicleFitmentUncheckedUpdateInput = {};
  if (input.make !== undefined) {
    if (!input.make.trim()) throw new ValidationError("Make is required");
    data.make = input.make.trim();
  }
  for (const f of ["model", "variant", "engine", "engineCode", "fuelType", "transmission", "notes"] as const) {
    if (input[f] !== undefined) data[f] = input[f]?.toString().trim() || null;
  }
  for (const f of ["yearFrom", "yearTo"] as const) {
    if (input[f] !== undefined) {
      if (input[f] !== null && (!Number.isInteger(input[f]) || input[f]! < 1900 || input[f]! > 2100)) throw new ValidationError("Invalid year");
      data[f] = input[f];
    }
  }
  const from = data.yearFrom as number | null | undefined;
  const to = data.yearTo as number | null | undefined;
  if (from != null && to != null && from > to) throw new ValidationError("Year from cannot be after year to");
  return data;
}

async function assertPart(businessId: string, partId: string) {
  const part = await db.part.findFirst({ where: { id: partId, businessId }, select: { id: true, sku: true, name: true } });
  if (!part) throw new NotFoundError("Part");
  return part;
}

export async function listFitment(
  businessId: string,
  opts: { partId?: string; q?: string; page?: number; pageSize?: number } = {},
) {
  const pageSize = Math.min(opts.pageSize ?? 50, 200);
  const page = Math.max(opts.page ?? 1, 1);
  const q = opts.q?.trim();
  const where: Prisma.VehicleFitmentWhereInput = {
    part: { businessId },
    ...(opts.partId ? { partId: opts.partId } : {}),
    ...(q
      ? {
          OR: [
            { make: { contains: q, mode: "insensitive" } },
            { model: { contains: q, mode: "insensitive" } },
            { engine: { contains: q, mode: "insensitive" } },
            { part: { name: { contains: q, mode: "insensitive" } } },
            { part: { partNumber: { contains: q, mode: "insensitive" } } },
            { part: { sku: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.vehicleFitment.findMany({
      where,
      orderBy: [{ make: "asc" }, { model: "asc" }, { yearFrom: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { part: { select: { id: true, sku: true, partNumber: true, name: true } } },
    }),
    db.vehicleFitment.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function addFitment(actor: Actor, partId: string, input: FitmentInput) {
  const part = await assertPart(actor.businessId, partId);
  const data = cleanFitment(input) as Prisma.VehicleFitmentUncheckedCreateInput;
  const fitment = await db.vehicleFitment.create({ data: { ...data, make: data.make, partId } });
  await audit(actor, {
    action: "fitment.create",
    entityType: "VehicleFitment",
    entityId: fitment.id,
    summary: `Fitment added to ${part.sku}: ${[fitment.make, fitment.model, fitment.yearFrom, fitment.yearTo].filter(Boolean).join(" ")}`,
  });
  return fitment;
}

export async function updateFitment(actor: Actor, id: string, input: Partial<FitmentInput>) {
  const existing = await db.vehicleFitment.findFirst({ where: { id, part: { businessId: actor.businessId } }, include: { part: true } });
  if (!existing) throw new NotFoundError("Fitment");
  const data = cleanFitment(input);
  const fitment = await db.vehicleFitment.update({ where: { id }, data });
  await audit(actor, { action: "fitment.update", entityType: "VehicleFitment", entityId: id, summary: `Fitment updated on ${existing.part.sku}` });
  return fitment;
}

export async function deleteFitment(actor: Actor, id: string) {
  const existing = await db.vehicleFitment.findFirst({ where: { id, part: { businessId: actor.businessId } }, include: { part: true } });
  if (!existing) throw new NotFoundError("Fitment");
  await db.vehicleFitment.delete({ where: { id } });
  await audit(actor, { action: "fitment.delete", entityType: "VehicleFitment", entityId: id, summary: `Fitment removed from ${existing.part.sku}` });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function exportPartsCsv(businessId: string): Promise<string> {
  const parts = await db.part.findMany({ where: { businessId }, orderBy: { sku: "asc" } });
  const header = [
    "SKU", "Part Number", "Barcode", "Description", "Long Description", "Manufacturer", "Category", "Cost Price",
    "Selling Price", "VAT Rate", "Stock Quantity", "Minimum Stock", "Location", "Universal", "Recommended", "Status",
  ];
  const lines = [header.join(",")];
  for (const p of parts) {
    lines.push(
      [
        p.sku, p.partNumber, p.barcode, p.name, p.description, p.manufacturer, p.category, toNumber(p.costPrice).toFixed(2),
        toNumber(p.sellingPrice).toFixed(2), p.vatRate === null ? "" : toNumber(p.vatRate), p.quantityInStock,
        p.minimumStockLevel, p.location, p.universal ? "yes" : "no", p.recommended ? "yes" : "no", p.active ? "Active" : "Inactive",
      ].map(csvCell).join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export async function exportFitmentCsv(businessId: string): Promise<string> {
  const rows = await db.vehicleFitment.findMany({
    where: { part: { businessId } },
    include: { part: { select: { sku: true, partNumber: true } } },
    orderBy: [{ make: "asc" }, { model: "asc" }],
  });
  const header = ["Part Number", "SKU", "Make", "Model", "Year From", "Year To", "Variant", "Engine", "Engine Code", "Fuel Type", "Transmission", "Notes"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.part.partNumber, r.part.sku, r.make, r.model, r.yearFrom, r.yearTo, r.variant, r.engine, r.engineCode, r.fuelType, r.transmission, r.notes]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
