import type {
  Business,
  Prisma,
  QuotationSource,
  QuotationStatus,
} from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import {
  ConflictError,
  errorMessage,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { audit } from "@/services/audit";
import { calculateQuote } from "@/services/quotes/calc";
import { labourLineDefaults } from "@/services/labour";
import { buildQuotePdf, type QuotePdfData } from "@/services/pdf/quotePdf";
import { getStorage } from "@/services/storage";
import { addInternalNote, findOrCreateConversation } from "@/services/conversations";
import { describeVehicle } from "@/services/vehicles";
import { getCredentials, getWhatsAppService } from "@/services/whatsapp";
import { formatMoney, toNumber } from "@/utils/money";
import type { Actor, UserActor } from "@/types/actor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuoteItemInput {
  /** Existing line id (for edits). Omit for new lines. */
  id?: string;
  partId?: string | null;
  description?: string;
  sku?: string | null;
  partNumber?: string | null;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  vatRate?: number;
  fitmentConfidence?: string | null;
  matchNote?: string | null;
  alternatives?: Prisma.InputJsonValue | null;
}

export interface QuoteLabourInput {
  id?: string;
  labourId?: string | null;
  description?: string;
  hours?: number;
  unitPrice?: number;
  vatRate?: number;
}

export interface CreateQuoteInput {
  customerId: string;
  vehicleId?: string | null;
  conversationId?: string | null;
  items?: QuoteItemInput[];
  labour?: QuoteLabourInput[];
  notes?: string | null;
  internalNotes?: string | null;
  validUntil?: Date | null;
  vatRate?: number;
  pricesIncludeVat?: boolean;
  source?: QuotationSource;
}

export interface UpdateQuoteInput {
  customerId?: string;
  vehicleId?: string | null;
  items?: QuoteItemInput[];
  labour?: QuoteLabourInput[];
  notes?: string | null;
  internalNotes?: string | null;
  validUntil?: Date | null;
  vatRate?: number;
  pricesIncludeVat?: boolean;
}

interface ResolvedItem {
  id?: string;
  partId: string | null;
  description: string;
  sku: string | null;
  partNumber: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate: number;
  fitmentConfidence: string | null;
  matchNote: string | null;
  alternatives: Prisma.InputJsonValue | null;
}

interface ResolvedLabour {
  id?: string;
  labourId: string | null;
  description: string;
  hours: number;
  unitPrice: number;
  vatRate: number;
}

const EDITABLE: QuotationStatus[] = ["DRAFT", "PENDING_APPROVAL"];
const OPEN_FOR_CONVERSATION: QuotationStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED"];

export const quoteInclude = {
  customer: true,
  vehicle: true,
  items: { orderBy: { position: "asc" } },
  labour: { orderBy: { position: "asc" } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  conversation: { select: { id: true, status: true } },
} satisfies Prisma.QuotationInclude;

export type QuotationFull = Prisma.QuotationGetPayload<{ include: typeof quoteInclude }>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function nextQuoteNumber(tx: Tx, business: Pick<Business, "id" | "quotePrefix">): Promise<string> {
  const year = new Date().getFullYear();
  const seq = await tx.quoteSequence.upsert({
    where: { businessId_year: { businessId: business.id, year } },
    create: { businessId: business.id, year, last: 1 },
    update: { last: { increment: 1 } },
  });
  return `${business.quotePrefix}-${year}-${String(seq.last).padStart(6, "0")}`;
}

async function loadBusiness(businessId: string): Promise<Business> {
  const b = await db.business.findUnique({ where: { id: businessId } });
  if (!b) throw new NotFoundError("Business");
  return b;
}

async function assertCustomerAndVehicle(businessId: string, customerId?: string, vehicleId?: string | null) {
  if (customerId) {
    const c = await db.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } });
    if (!c) throw new NotFoundError("Customer");
  }
  if (vehicleId) {
    const v = await db.vehicle.findFirst({ where: { id: vehicleId, businessId }, select: { id: true } });
    if (!v) throw new NotFoundError("Vehicle");
  }
}

async function resolveItems(
  actor: Actor,
  businessId: string,
  quoteVatRate: number,
  inputs: QuoteItemInput[],
  existing: Map<string, { partId: string | null; description: string; sku: string | null; partNumber: string | null; quantity: unknown; unitPrice: unknown; discount: unknown; vatRate: unknown; fitmentConfidence: string | null; matchNote: string | null; alternatives: unknown }>,
): Promise<ResolvedItem[]> {
  const isAi = actor.kind === "ai";
  const partIds = [...new Set(inputs.map((i) => i.partId).filter((x): x is string => !!x))];
  const parts = await db.part.findMany({ where: { id: { in: partIds }, businessId } });
  const partMap = new Map(parts.map((p) => [p.id, p]));

  return inputs.map((inp, idx) => {
    const label = `Part line ${idx + 1}`;
    const prev = inp.id ? existing.get(inp.id) : undefined;
    if (inp.id && !prev) throw new ValidationError(`${label}: unknown line id`);

    const partId = inp.partId === undefined ? prev?.partId ?? null : inp.partId;
    const part = partId ? partMap.get(partId) : undefined;
    if (partId && !part) throw new NotFoundError("Part");
    if (isAi && !part) throw new ForbiddenError("The assistant can only quote parts that exist in inventory");

    const description = (inp.description ?? prev?.description ?? part?.name ?? "").trim();
    if (!description) throw new ValidationError(`${label}: description is required`);

    // Prices: business users may override; the AI never can. Existing lines keep their saved price.
    let unitPrice: number;
    if (!isAi && inp.unitPrice !== undefined) unitPrice = inp.unitPrice;
    else if (prev && partId === prev.partId) unitPrice = toNumber(prev.unitPrice as never);
    else if (part) unitPrice = toNumber(part.sellingPrice);
    else throw new ValidationError(`${label}: a price is required for custom items`);

    const discount = isAi ? 0 : inp.discount ?? (prev ? toNumber(prev.discount as never) : 0);
    const vatRate = isAi
      ? part?.vatRate != null ? toNumber(part.vatRate) : quoteVatRate
      : inp.vatRate ?? (prev ? toNumber(prev.vatRate as never) : part?.vatRate != null ? toNumber(part.vatRate) : quoteVatRate);

    return {
      id: inp.id,
      partId,
      description,
      sku: inp.sku !== undefined ? inp.sku : prev?.sku ?? part?.sku ?? null,
      partNumber: inp.partNumber !== undefined ? inp.partNumber : prev?.partNumber ?? part?.partNumber ?? null,
      quantity: inp.quantity,
      unitPrice,
      discount,
      vatRate,
      fitmentConfidence: inp.fitmentConfidence !== undefined ? inp.fitmentConfidence : prev?.fitmentConfidence ?? null,
      matchNote: inp.matchNote !== undefined ? inp.matchNote : prev?.matchNote ?? null,
      alternatives: inp.alternatives !== undefined ? inp.alternatives : (prev?.alternatives as Prisma.InputJsonValue | null) ?? null,
    };
  });
}

async function resolveLabour(
  actor: Actor,
  businessId: string,
  quoteVatRate: number,
  inputs: QuoteLabourInput[],
  existing: Map<string, { labourId: string | null; description: string; hours: unknown; unitPrice: unknown; vatRate: unknown }>,
): Promise<ResolvedLabour[]> {
  const isAi = actor.kind === "ai";
  const ids = [...new Set(inputs.map((i) => i.labourId).filter((x): x is string => !!x))];
  const rates = await db.labourRate.findMany({ where: { id: { in: ids }, businessId } });
  const rateMap = new Map(rates.map((r) => [r.id, r]));

  return inputs.map((inp, idx) => {
    const label = `Labour line ${idx + 1}`;
    const prev = inp.id ? existing.get(inp.id) : undefined;
    if (inp.id && !prev) throw new ValidationError(`${label}: unknown line id`);
    const labourId = inp.labourId === undefined ? prev?.labourId ?? null : inp.labourId;
    const rate = labourId ? rateMap.get(labourId) : undefined;
    if (labourId && !rate) throw new NotFoundError("Labour rate");
    if (isAi && !rate) throw new ForbiddenError("The assistant can only use configured labour rates");

    const defaults = rate ? labourLineDefaults(rate, inp.hours) : null;
    const description = (inp.description ?? prev?.description ?? rate?.name ?? "").trim();
    if (!description) throw new ValidationError(`${label}: description is required`);

    const hours = inp.hours ?? (prev && labourId === prev.labourId ? toNumber(prev.hours as never) : defaults?.hours);
    if (hours === undefined) throw new ValidationError(`${label}: hours are required`);
    let unitPrice: number;
    if (!isAi && inp.unitPrice !== undefined) unitPrice = inp.unitPrice;
    else if (prev && labourId === prev.labourId) unitPrice = toNumber(prev.unitPrice as never);
    else if (defaults) unitPrice = defaults.unitPrice;
    else throw new ValidationError(`${label}: a rate is required for custom labour`);
    // Fixed-price rates are always quantity 1 unless the business edits them.
    const finalHours = isAi && rate && defaults && defaults.hours === 1 && toNumber(rate.fixedPrice as never) > 0 && !rate.hourlyRate ? 1 : hours;

    const vatRate = isAi ? quoteVatRate : inp.vatRate ?? (prev ? toNumber(prev.vatRate as never) : quoteVatRate);
    return { id: inp.id, labourId, description, hours: finalHours, unitPrice, vatRate };
  });
}

function computeTotals(items: ResolvedItem[], labour: ResolvedLabour[], pricesIncludeVat: boolean) {
  return calculateQuote({
    items: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount, vatRate: i.vatRate })),
    labour: labour.map((l) => ({ hours: l.hours, unitPrice: l.unitPrice, vatRate: l.vatRate })),
    pricesIncludeVat,
  });
}

async function writeLines(
  tx: Tx,
  quotationId: string,
  items: ResolvedItem[],
  labour: ResolvedLabour[],
  calc: ReturnType<typeof computeTotals>,
  existingItemIds: Set<string>,
  existingLabourIds: Set<string>,
) {
  const keepItems = items.map((i) => i.id).filter((x): x is string => !!x);
  await tx.quotationItem.deleteMany({ where: { quotationId, id: { notIn: keepItems } } });
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const r = calc.items[i];
    const data = {
      position: i,
      partId: it.partId,
      description: it.description,
      sku: it.sku,
      partNumber: it.partNumber,
      quantity: it.quantity.toFixed(2),
      unitPrice: it.unitPrice.toFixed(2),
      discount: r.discount,
      vatRate: r.vatRate,
      vat: r.vat,
      total: r.total,
      fitmentConfidence: it.fitmentConfidence,
      matchNote: it.matchNote,
      alternatives: it.alternatives === null ? undefined : it.alternatives,
    };
    if (it.id && existingItemIds.has(it.id)) await tx.quotationItem.update({ where: { id: it.id }, data });
    else await tx.quotationItem.create({ data: { ...data, quotationId } });
  }

  const keepLabour = labour.map((l) => l.id).filter((x): x is string => !!x);
  await tx.quotationLabour.deleteMany({ where: { quotationId, id: { notIn: keepLabour } } });
  for (let i = 0; i < labour.length; i++) {
    const l = labour[i];
    const r = calc.labour[i];
    const data = {
      position: i,
      labourId: l.labourId,
      description: l.description,
      hours: l.hours.toFixed(2),
      unitPrice: l.unitPrice.toFixed(2),
      vatRate: r.vatRate,
      vat: r.vat,
      total: r.total,
    };
    if (l.id && existingLabourIds.has(l.id)) await tx.quotationLabour.update({ where: { id: l.id }, data });
    else await tx.quotationLabour.create({ data: { ...data, quotationId } });
  }
}

function totalsData(calc: ReturnType<typeof computeTotals>) {
  return {
    subtotal: calc.totals.subtotal,
    labourTotal: calc.totals.labourTotal,
    discount: calc.totals.discount,
    vat: calc.totals.vat,
    total: calc.totals.total,
  };
}

export async function expireOverdueQuotes(businessId: string) {
  await db.quotation.updateMany({
    where: { businessId, status: "SENT", validUntil: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createQuotation(actor: Actor, input: CreateQuoteInput): Promise<QuotationFull> {
  const business = await loadBusiness(actor.businessId);
  await assertCustomerAndVehicle(actor.businessId, input.customerId, input.vehicleId);

  if (input.conversationId) {
    const conv = await db.conversation.findFirst({ where: { id: input.conversationId, businessId: actor.businessId } });
    if (!conv) throw new NotFoundError("Conversation");
    const open = await db.quotation.findFirst({
      where: { conversationId: input.conversationId, businessId: actor.businessId, status: { in: OPEN_FOR_CONVERSATION } },
      select: { id: true, quoteNumber: true },
    });
    if (open) throw new ConflictError(`Quotation ${open.quoteNumber} is already open for this conversation`, { quotationId: open.id });
  }

  const vatRate = input.vatRate ?? toNumber(business.vatRate);
  const pricesIncludeVat = input.pricesIncludeVat ?? business.pricesIncludeVat;
  const items = await resolveItems(actor, actor.businessId, vatRate, input.items ?? [], new Map());
  const labour = await resolveLabour(actor, actor.businessId, vatRate, input.labour ?? [], new Map());
  const calc = computeTotals(items, labour, pricesIncludeVat);

  const validUntil = input.validUntil === undefined ? new Date(Date.now() + business.quoteValidityDays * 86_400_000) : input.validUntil;

  const created = await db.$transaction(async (tx) => {
    const quoteNumber = await nextQuoteNumber(tx, business);
    const q = await tx.quotation.create({
      data: {
        businessId: actor.businessId,
        customerId: input.customerId,
        vehicleId: input.vehicleId ?? null,
        conversationId: input.conversationId ?? null,
        quoteNumber,
        status: "DRAFT",
        source: input.source ?? (actor.kind === "ai" ? "AI" : "MANUAL"),
        ...totalsData(calc),
        vatRate: vatRate.toFixed(2),
        pricesIncludeVat,
        validUntil,
        notes: input.notes?.trim() || null,
        internalNotes: input.internalNotes?.trim() || null,
        createdById: actor.kind === "user" ? actor.userId : null,
      },
    });
    await writeLines(tx, q.id, items, labour, calc, new Set(), new Set());
    await audit(
      actor,
      {
        action: "quote.create",
        entityType: "Quotation",
        entityId: q.id,
        summary: `Quotation ${quoteNumber} created (${items.length} parts, ${labour.length} labour, total ${calc.totals.total})`,
        details: { source: q.source, total: calc.totals.total },
      },
      tx,
    );
    return q;
  });
  return getQuotationFull(actor.businessId, created.id);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getQuotationFull(businessId: string, id: string): Promise<QuotationFull> {
  const q = await db.quotation.findFirst({ where: { id, businessId }, include: quoteInclude });
  if (!q) throw new NotFoundError("Quotation");
  return q;
}

export interface ListQuotesOptions {
  q?: string;
  status?: QuotationStatus | QuotationStatus[];
  customer?: string;
  vehicle?: string;
  customerId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
}

export async function listQuotations(businessId: string, opts: ListQuotesOptions = {}) {
  await expireOverdueQuotes(businessId);
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const and: Prisma.QuotationWhereInput[] = [];
  const q = opts.q?.trim();
  if (q) {
    and.push({
      OR: [
        { quoteNumber: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { customer: { phone: { contains: q } } },
        { vehicle: { make: { contains: q, mode: "insensitive" } } },
        { vehicle: { model: { contains: q, mode: "insensitive" } } },
        { vehicle: { registrationNumber: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (opts.status) and.push({ status: Array.isArray(opts.status) ? { in: opts.status } : opts.status });
  if (opts.customerId) and.push({ customerId: opts.customerId });
  if (opts.customer?.trim()) {
    and.push({ customer: { OR: [{ name: { contains: opts.customer.trim(), mode: "insensitive" } }, { phone: { contains: opts.customer.trim() } }] } });
  }
  if (opts.vehicle?.trim()) {
    const v = opts.vehicle.trim();
    and.push({ vehicle: { OR: [{ make: { contains: v, mode: "insensitive" } }, { model: { contains: v, mode: "insensitive" } }, { registrationNumber: { contains: v, mode: "insensitive" } }, { vin: { contains: v, mode: "insensitive" } }] } });
  }
  if (opts.dateFrom) and.push({ createdAt: { gte: opts.dateFrom } });
  if (opts.dateTo) and.push({ createdAt: { lte: opts.dateTo } });
  const where: Prisma.QuotationWhereInput = { businessId, AND: and };

  const [items, total] = await Promise.all([
    db.quotation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        vehicle: { select: { id: true, year: true, make: true, model: true, variant: true, engine: true, registrationNumber: true } },
        approvedBy: { select: { name: true } },
      },
    }),
    db.quotation.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateQuotation(actor: Actor, id: string, input: UpdateQuoteInput): Promise<QuotationFull> {
  const current = await getQuotationFull(actor.businessId, id);
  if (!EDITABLE.includes(current.status)) {
    throw new InvalidStateError(`A ${current.status.toLowerCase().replace("_", " ")} quotation is locked and cannot be edited. Duplicate it to make changes.`);
  }
  if (actor.kind === "ai" && current.status !== "DRAFT") {
    throw new ForbiddenError("The assistant cannot edit a quotation that has been submitted for approval");
  }
  if (actor.kind === "ai" && current.conversationId !== actor.conversationId) {
    throw new ForbiddenError("This quotation belongs to a different conversation");
  }
  await assertCustomerAndVehicle(actor.businessId, input.customerId, input.vehicleId);

  const vatRate = input.vatRate ?? toNumber(current.vatRate);
  const pricesIncludeVat = input.pricesIncludeVat ?? current.pricesIncludeVat;

  const existingItems = new Map(current.items.map((i) => [i.id, i]));
  const existingLabour = new Map(current.labour.map((l) => [l.id, l]));
  const items =
    input.items !== undefined
      ? await resolveItems(actor, actor.businessId, vatRate, input.items, existingItems)
      : current.items.map<ResolvedItem>((i) => ({
          id: i.id, partId: i.partId, description: i.description, sku: i.sku, partNumber: i.partNumber,
          quantity: toNumber(i.quantity), unitPrice: toNumber(i.unitPrice), discount: toNumber(i.discount), vatRate: toNumber(i.vatRate),
          fitmentConfidence: i.fitmentConfidence, matchNote: i.matchNote, alternatives: (i.alternatives as Prisma.InputJsonValue | null) ?? null,
        }));
  const labour =
    input.labour !== undefined
      ? await resolveLabour(actor, actor.businessId, vatRate, input.labour, existingLabour)
      : current.labour.map<ResolvedLabour>((l) => ({
          id: l.id, labourId: l.labourId, description: l.description, hours: toNumber(l.hours), unitPrice: toNumber(l.unitPrice), vatRate: toNumber(l.vatRate),
        }));
  const calc = computeTotals(items, labour, pricesIncludeVat);

  const headerChanges: Record<string, { from: unknown; to: unknown }> = {};
  const track = (k: string, from: unknown, to: unknown) => {
    if (String(from ?? "") !== String(to ?? "")) headerChanges[k] = { from: from ?? null, to: to ?? null };
  };
  const data: Prisma.QuotationUncheckedUpdateInput = { ...totalsData(calc), vatRate: vatRate.toFixed(2), pricesIncludeVat };
  track("vatRate", toNumber(current.vatRate), vatRate);
  track("pricesIncludeVat", current.pricesIncludeVat, pricesIncludeVat);
  if (input.customerId !== undefined) { data.customerId = input.customerId; track("customerId", current.customerId, input.customerId); }
  if (input.vehicleId !== undefined) { data.vehicleId = input.vehicleId; track("vehicleId", current.vehicleId, input.vehicleId); }
  if (input.notes !== undefined) { data.notes = input.notes?.trim() || null; track("notes", current.notes, data.notes); }
  if (input.internalNotes !== undefined) { data.internalNotes = input.internalNotes?.trim() || null; track("internalNotes", current.internalNotes, data.internalNotes); }
  if (input.validUntil !== undefined) {
    data.validUntil = input.validUntil;
    track("validUntil", current.validUntil?.toISOString().slice(0, 10), input.validUntil?.toISOString().slice(0, 10));
  }

  // ---- Diff lines for the audit trail ----------------------------------------
  const oldItems = new Map(current.items.map((i) => [i.id, i]));
  const added: string[] = [];
  const priceChanges: { line: string; from: { unitPrice: number; discount: number }; to: { unitPrice: number; discount: number } }[] = [];
  const otherChanges: string[] = [];
  items.forEach((it) => {
    const old = it.id ? oldItems.get(it.id) : undefined;
    if (!old) added.push(`${it.description} x${it.quantity}`);
    else {
      if (toNumber(old.unitPrice) !== it.unitPrice || toNumber(old.discount) !== it.discount) {
        priceChanges.push({
          line: it.description,
          from: { unitPrice: toNumber(old.unitPrice), discount: toNumber(old.discount) },
          to: { unitPrice: it.unitPrice, discount: it.discount },
        });
      }
      if (toNumber(old.quantity) !== it.quantity) otherChanges.push(`${it.description} qty ${toNumber(old.quantity)} -> ${it.quantity}`);
      if (toNumber(old.vatRate) !== it.vatRate) otherChanges.push(`${it.description} VAT ${toNumber(old.vatRate)}% -> ${it.vatRate}%`);
      if (old.partId !== it.partId) otherChanges.push(`${old.description} replaced by ${it.description}`);
    }
  });
  const keptIds = new Set(items.map((i) => i.id).filter(Boolean));
  const removed = current.items.filter((i) => !keptIds.has(i.id)).map((i) => `${i.description} x${toNumber(i.quantity)}`);
  const oldLabour = new Map(current.labour.map((l) => [l.id, l]));
  const labourAdded: string[] = [];
  labour.forEach((l) => {
    const old = l.id ? oldLabour.get(l.id) : undefined;
    if (!old) labourAdded.push(l.description);
    else if (toNumber(old.unitPrice) !== l.unitPrice || toNumber(old.hours) !== l.hours) {
      priceChanges.push({ line: `Labour: ${l.description}`, from: { unitPrice: toNumber(old.unitPrice), discount: 0 }, to: { unitPrice: l.unitPrice, discount: 0 } });
      if (toNumber(old.hours) !== l.hours) otherChanges.push(`${l.description} hours ${toNumber(old.hours)} -> ${l.hours}`);
    }
  });
  const labourKept = new Set(labour.map((l) => l.id).filter(Boolean));
  const labourRemoved = current.labour.filter((l) => !labourKept.has(l.id)).map((l) => l.description);

  await db.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id }, data });
    await writeLines(tx, id, items, labour, calc, new Set(current.items.map((i) => i.id)), new Set(current.labour.map((l) => l.id)));

    const base = { entityType: "Quotation", entityId: id } as const;
    const ref = current.quoteNumber;
    if (added.length || labourAdded.length) {
      await audit(actor, { ...base, action: "quote.item_add", summary: `${ref}: added ${[...added, ...labourAdded.map((l) => `labour ${l}`)].join(", ")}`, details: { parts: added, labour: labourAdded } }, tx);
    }
    if (removed.length || labourRemoved.length) {
      await audit(actor, { ...base, action: "quote.item_remove", summary: `${ref}: removed ${[...removed, ...labourRemoved.map((l) => `labour ${l}`)].join(", ")}`, details: { parts: removed, labour: labourRemoved } }, tx);
    }
    if (priceChanges.length) {
      await audit(actor, { ...base, action: "quote.price_change", summary: `${ref}: price changed on ${priceChanges.map((p) => p.line).join(", ")}`, details: priceChanges as unknown as Prisma.InputJsonValue }, tx);
    }
    if (otherChanges.length || Object.keys(headerChanges).length) {
      await audit(actor, { ...base, action: "quote.update", summary: `${ref}: ${[...otherChanges, ...Object.keys(headerChanges)].join("; ")}`, details: { lines: otherChanges, header: headerChanges } as unknown as Prisma.InputJsonValue }, tx);
    }
    await audit(actor, { ...base, action: "quote.save", summary: `${ref} saved (total ${calc.totals.total})`, details: { total: calc.totals.total } }, tx);
  });
  return getQuotationFull(actor.businessId, id);
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/** Move a DRAFT to PENDING_APPROVAL. Safe for the AI to call: it does not approve or send anything. */
export async function submitForApproval(actor: Actor, id: string): Promise<QuotationFull> {
  const q = await getQuotationFull(actor.businessId, id);
  if (actor.kind === "ai" && q.conversationId !== actor.conversationId) {
    throw new ForbiddenError("This quotation belongs to a different conversation");
  }
  if (q.status === "PENDING_APPROVAL") return q;
  if (q.status !== "DRAFT") throw new InvalidStateError(`Only draft quotations can be submitted for approval (this one is ${q.status})`);
  if (q.items.length + q.labour.length === 0) throw new ValidationError("Add at least one part or labour line before submitting");

  await db.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
    if (q.conversationId) {
      await tx.conversation.updateMany({
        where: { id: q.conversationId, status: { notIn: ["HUMAN_REQUIRED", "CLOSED", "COMPLETED"] } },
        data: { status: "QUOTE_APPROVAL" },
      });
    }
    await audit(actor, { action: "quote.submit", entityType: "Quotation", entityId: id, summary: `${q.quoteNumber} submitted for approval` }, tx);
  });
  return getQuotationFull(actor.businessId, id);
}

export interface ApprovalResult {
  quotation: QuotationFull;
  sent: boolean;
  error?: string;
  warnings: string[];
}

function validateForApproval(q: QuotationFull) {
  if (!q.customer.phone) throw new ValidationError("The customer has no WhatsApp number");
  if (q.items.length + q.labour.length === 0) throw new ValidationError("The quotation has no lines");
  if (q.validUntil && q.validUntil.getTime() < Date.now() - 86_400_000) {
    throw new ValidationError("The validity date has already passed. Extend 'valid until' before approving.");
  }
}

async function stockWarnings(q: QuotationFull): Promise<string[]> {
  const partIds = q.items.map((i) => i.partId).filter((x): x is string => !!x);
  if (!partIds.length) return [];
  const parts = await db.part.findMany({ where: { id: { in: partIds }, businessId: q.businessId } });
  const map = new Map(parts.map((p) => [p.id, p]));
  const warnings: string[] = [];
  for (const it of q.items) {
    const p = it.partId ? map.get(it.partId) : undefined;
    if (!p) continue;
    if (!p.active) warnings.push(`${it.description} is inactive in inventory`);
    else if (p.quantityInStock < toNumber(it.quantity)) {
      warnings.push(`${it.description}: only ${p.quantityInStock} in stock (quoted ${toNumber(it.quantity)})`);
    }
  }
  return warnings;
}

/**
 * Validate -> lock pricing -> recompute totals server-side -> generate + store PDF
 * -> (optionally) send over WhatsApp. Only business users can call this.
 */
export async function approveQuotation(actor: UserActor, id: string, opts: { send?: boolean } = {}): Promise<ApprovalResult> {
  if (actor.kind !== "user") throw new ForbiddenError("Only business users can approve quotations");
  const send = opts.send ?? true;
  const q = await getQuotationFull(actor.businessId, id);

  if (q.status === "APPROVED" && send) {
    const r = await sendQuotation(actor, id);
    return { ...r, warnings: [] };
  }
  if (!EDITABLE.includes(q.status)) {
    throw new InvalidStateError(`This quotation is ${q.status} and cannot be approved`);
  }
  validateForApproval(q);
  const warnings = await stockWarnings(q);

  // Recompute every figure from the persisted lines. Never trust stored or client totals.
  const items = q.items.map<ResolvedItem>((i) => ({
    id: i.id, partId: i.partId, description: i.description, sku: i.sku, partNumber: i.partNumber,
    quantity: toNumber(i.quantity), unitPrice: toNumber(i.unitPrice), discount: toNumber(i.discount), vatRate: toNumber(i.vatRate),
    fitmentConfidence: i.fitmentConfidence, matchNote: i.matchNote, alternatives: null,
  }));
  const labour = q.labour.map<ResolvedLabour>((l) => ({
    id: l.id, labourId: l.labourId, description: l.description, hours: toNumber(l.hours), unitPrice: toNumber(l.unitPrice), vatRate: toNumber(l.vatRate),
  }));
  const calc = computeTotals(items, labour, q.pricesIncludeVat);
  if (toNumber(calc.totals.total) <= 0) throw new ValidationError("The quotation total must be greater than zero");

  await db.$transaction(async (tx) => {
    const lock = await tx.quotation.updateMany({
      where: { id, businessId: actor.businessId, status: { in: EDITABLE } },
      data: {
        status: "APPROVED",
        approvedById: actor.userId,
        approvedAt: new Date(),
        sendError: null,
        ...totalsData(calc),
      },
    });
    if (lock.count !== 1) throw new ConflictError("This quotation was already approved or changed by someone else. Refresh and try again.");
    await writeLines(tx, id, items, labour, calc, new Set(q.items.map((i) => i.id)), new Set(q.labour.map((l) => l.id)));
    await audit(
      actor,
      {
        action: "quote.approve",
        entityType: "Quotation",
        entityId: id,
        summary: `${q.quoteNumber} approved by ${actor.name ?? actor.userId} (total ${calc.totals.total})`,
        details: { total: calc.totals.total, warnings },
      },
      tx,
    );
  });

  try {
    await generateAndStorePdf(actor.businessId, id);
  } catch (e) {
    const msg = `PDF generation failed: ${errorMessage(e)}`;
    await db.quotation.update({ where: { id }, data: { sendError: msg } });
    await audit(actor, { action: "quote.pdf_failed", entityType: "Quotation", entityId: id, summary: msg });
    return { quotation: await getQuotationFull(actor.businessId, id), sent: false, error: msg, warnings };
  }

  if (!send) return { quotation: await getQuotationFull(actor.businessId, id), sent: false, warnings };
  const result = await sendQuotation(actor, id);
  return { ...result, warnings };
}

export function buildWhatsAppCaption(q: Pick<QuotationFull, "quoteNumber" | "total" | "customer" | "vehicle">, business: Pick<Business, "currencySymbol">): string {
  const first = q.customer.name?.trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${first} 👋` : "Hi 👋";
  const vehicle = q.vehicle && (q.vehicle.make || q.vehicle.model) ? describeVehicle(q.vehicle) : null;
  return [
    greeting,
    "",
    vehicle ? `Your quotation for your ${vehicle} is ready.` : "Your quotation is ready.",
    "",
    `Quote: ${q.quoteNumber}`,
    `Total: ${formatMoney(q.total, business.currencySymbol)}`,
    "",
    "I've attached the quotation PDF for you.",
    "",
    "Please let us know if you'd like to proceed.",
  ].join("\n");
}

/** (Re)send the approved quotation PDF. Used for the first send, failed-send retries and resends. */
export async function sendQuotation(actor: UserActor, id: string): Promise<{ quotation: QuotationFull; sent: boolean; error?: string }> {
  if (actor.kind !== "user") throw new ForbiddenError("Only business users can send quotations");
  const q = await getQuotationFull(actor.businessId, id);
  if (q.status !== "APPROVED" && q.status !== "SENT") {
    throw new InvalidStateError(`Only approved quotations can be sent (this one is ${q.status}). Approve it first.`);
  }
  const business = await loadBusiness(actor.businessId);
  const isResend = q.status === "SENT";
  const attemptAt = new Date();

  const fail = async (message: string) => {
    await db.quotation.update({ where: { id }, data: { sendError: message, lastSendAttemptAt: attemptAt } });
    if (q.conversationId) {
      await addInternalNote(q.conversationId, `Failed to send ${q.quoteNumber} on WhatsApp: ${message}`);
    }
    await audit(actor, { action: "quote.send_failed", entityType: "Quotation", entityId: id, summary: `${q.quoteNumber} send failed: ${message}` });
    return { quotation: await getQuotationFull(actor.businessId, id), sent: false, error: message };
  };

  let pdf: Buffer;
  let pdfKey = q.pdfKey;
  try {
    const stored = pdfKey ? await getStorage().get(pdfKey) : null;
    if (stored) pdf = stored.data;
    else {
      const gen = await generateAndStorePdf(actor.businessId, id);
      pdf = gen.data;
      pdfKey = gen.key;
    }
  } catch (e) {
    return fail(`PDF generation failed: ${errorMessage(e)}`);
  }

  const caption = buildWhatsAppCaption(q, business);
  let waMessageId: string;
  try {
    const creds = getCredentials(business);
    const res = await getWhatsAppService().sendDocument(creds, {
      to: q.customer.phone,
      document: pdf,
      filename: `${q.quoteNumber}.pdf`,
      mimeType: "application/pdf",
      caption,
    });
    waMessageId = res.messageId;
  } catch (e) {
    return fail(errorMessage(e));
  }

  await db.$transaction(async (tx) => {
    let conversationId = q.conversationId;
    if (!conversationId) {
      const conv = await findOrCreateConversation({ kind: "system", businessId: actor.businessId }, q.customerId, q.customer.phone);
      conversationId = conv.id;
      await tx.quotation.update({ where: { id }, data: { conversationId } });
    }
    await tx.quotation.update({
      where: { id },
      data: {
        status: "SENT",
        sentAt: q.sentAt ?? attemptAt,
        whatsappMessageId: waMessageId,
        sendError: null,
        lastSendAttemptAt: attemptAt,
      },
    });
    await tx.message.create({
      data: {
        conversationId,
        direction: "OUTBOUND",
        sender: "BUSINESS",
        messageType: "DOCUMENT",
        content: caption,
        whatsappMessageId: waMessageId,
        deliveryStatus: "SENT",
        attachmentKey: pdfKey,
      },
    });
    await tx.conversation.updateMany({
      where: { id: conversationId, status: { notIn: ["HUMAN_REQUIRED", "CLOSED", "COMPLETED"] } },
      data: { status: "WAITING_FOR_CUSTOMER", lastMessageAt: new Date() },
    });
    await audit(
      actor,
      {
        action: isResend ? "quote.resend" : "quote.send",
        entityType: "Quotation",
        entityId: id,
        summary: `${q.quoteNumber} ${isResend ? "resent" : "sent"} to +${q.customer.phone} via WhatsApp`,
        details: { whatsappMessageId: waMessageId },
      },
      tx,
    );
  });
  return { quotation: await getQuotationFull(actor.businessId, id), sent: true };
}

export async function cancelQuotation(actor: Actor, id: string, reason?: string): Promise<QuotationFull> {
  const q = await getQuotationFull(actor.businessId, id);
  if (["CANCELLED", "ACCEPTED", "REJECTED"].includes(q.status)) {
    throw new InvalidStateError(`A ${q.status.toLowerCase()} quotation cannot be cancelled`);
  }
  await db.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id }, data: { status: "CANCELLED" } });
    if (q.conversationId) {
      await tx.conversation.updateMany({ where: { id: q.conversationId, status: "QUOTE_APPROVAL" }, data: { status: "ACTIVE" } });
    }
    await audit(actor, { action: "quote.cancel", entityType: "Quotation", entityId: id, summary: `${q.quoteNumber} cancelled${reason ? `: ${reason}` : ""}`, details: { reason: reason ?? null, previousStatus: q.status } }, tx);
  });
  return getQuotationFull(actor.businessId, id);
}

export async function duplicateQuotation(actor: Actor, id: string): Promise<QuotationFull> {
  const q = await getQuotationFull(actor.businessId, id);
  const business = await loadBusiness(actor.businessId);
  const copy = await db.$transaction(async (tx) => {
    const quoteNumber = await nextQuoteNumber(tx, business);
    const n = await tx.quotation.create({
      data: {
        businessId: actor.businessId,
        customerId: q.customerId,
        vehicleId: q.vehicleId,
        conversationId: q.conversationId,
        quoteNumber,
        status: "DRAFT",
        source: "MANUAL",
        subtotal: q.subtotal,
        labourTotal: q.labourTotal,
        discount: q.discount,
        vat: q.vat,
        total: q.total,
        vatRate: q.vatRate,
        pricesIncludeVat: q.pricesIncludeVat,
        validUntil: new Date(Date.now() + business.quoteValidityDays * 86_400_000),
        notes: q.notes,
        internalNotes: q.internalNotes,
        createdById: actor.kind === "user" ? actor.userId : null,
      },
    });
    await tx.quotationItem.createMany({
      data: q.items.map((i) => ({
        quotationId: n.id, position: i.position, partId: i.partId, description: i.description, sku: i.sku, partNumber: i.partNumber,
        quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount, vatRate: i.vatRate, vat: i.vat, total: i.total,
        fitmentConfidence: i.fitmentConfidence, matchNote: i.matchNote,
      })),
    });
    await tx.quotationLabour.createMany({
      data: q.labour.map((l) => ({
        quotationId: n.id, position: l.position, labourId: l.labourId, description: l.description, hours: l.hours,
        unitPrice: l.unitPrice, vatRate: l.vatRate, vat: l.vat, total: l.total,
      })),
    });
    await audit(actor, { action: "quote.duplicate", entityType: "Quotation", entityId: n.id, summary: `${quoteNumber} duplicated from ${q.quoteNumber}` }, tx);
    return n;
  });
  return getQuotationFull(actor.businessId, copy.id);
}

/** Record the customer's decision. For the MVP this is entered by staff; a customer-facing accept link can call the same function later. */
export async function respondToQuotation(actor: Actor, id: string, decision: "ACCEPTED" | "REJECTED"): Promise<QuotationFull> {
  const q = await getQuotationFull(actor.businessId, id);
  if (q.status !== "SENT") throw new InvalidStateError("Only quotations that were sent to the customer can be accepted or declined");
  await db.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id }, data: { status: decision, respondedAt: new Date() } });
    await audit(actor, { action: decision === "ACCEPTED" ? "quote.accept" : "quote.reject", entityType: "Quotation", entityId: id, summary: `${q.quoteNumber} marked ${decision.toLowerCase()}` }, tx);
  });
  return getQuotationFull(actor.businessId, id);
}

/** Create (or return the existing open) draft for a conversation: used by the "Create Quote" button. */
export async function getOrCreateDraftForConversation(actor: Actor, conversationId: string): Promise<{ quotation: QuotationFull; created: boolean }> {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, businessId: actor.businessId } });
  if (!conv) throw new NotFoundError("Conversation");
  const open = await db.quotation.findFirst({
    where: { conversationId, businessId: actor.businessId, status: { in: OPEN_FOR_CONVERSATION } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (open) return { quotation: await getQuotationFull(actor.businessId, open.id), created: false };
  const quotation = await createQuotation(actor, {
    customerId: conv.customerId,
    vehicleId: conv.vehicleId,
    conversationId,
    source: "MANUAL",
  });
  return { quotation, created: true };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export async function buildPdfData(q: QuotationFull, business: Business): Promise<QuotePdfData> {
  let logo: Buffer | null = null;
  if (business.logoKey) {
    try {
      logo = (await getStorage().get(business.logoKey))?.data ?? null;
    } catch {
      logo = null;
    }
  }
  return {
    business: {
      name: business.name,
      tradingName: business.tradingName,
      registrationNumber: business.registrationNumber,
      vatNumber: business.vatNumber,
      address: business.address,
      phone: business.phone,
      email: business.email,
      currencySymbol: business.currencySymbol,
      paymentDetails: business.paymentDetails,
      termsAndConditions: business.termsAndConditions,
    },
    logo,
    quote: {
      quoteNumber: q.quoteNumber,
      createdAt: q.createdAt,
      validUntil: q.validUntil,
      notes: q.notes,
      subtotal: q.subtotal,
      labourTotal: q.labourTotal,
      discount: q.discount,
      vat: q.vat,
      total: q.total,
      vatRate: q.vatRate,
      pricesIncludeVat: q.pricesIncludeVat,
    },
    customer: q.customer,
    vehicle: q.vehicle,
    items: q.items,
    labour: q.labour,
  };
}

export async function generateAndStorePdf(businessId: string, id: string): Promise<{ key: string; data: Buffer }> {
  const [q, business] = await Promise.all([getQuotationFull(businessId, id), loadBusiness(businessId)]);
  const data = await buildQuotePdf(await buildPdfData(q, business));
  const key = `${businessId}/quotes/${q.quoteNumber}-${Date.now()}.pdf`;
  await getStorage().put(key, data, "application/pdf");
  await db.quotation.update({ where: { id }, data: { pdfKey: key, pdfUrl: `/api/quotations/${id}/pdf` } });
  return { key, data };
}

/** Stored PDF for approved quotes; a fresh unstored preview for drafts. */
export async function getQuotationPdf(businessId: string, id: string): Promise<{ data: Buffer; filename: string; preview: boolean }> {
  const q = await getQuotationFull(businessId, id);
  if (q.pdfKey) {
    const stored = await getStorage().get(q.pdfKey);
    if (stored) return { data: stored.data, filename: `${q.quoteNumber}.pdf`, preview: false };
  }
  const business = await loadBusiness(businessId);
  const pdfData = await buildPdfData(q, business);
  if (EDITABLE.includes(q.status)) pdfData.watermark = "DRAFT";
  const data = await buildQuotePdf(pdfData);
  return { data, filename: `${q.quoteNumber}${EDITABLE.includes(q.status) ? "-draft" : ""}.pdf`, preview: EDITABLE.includes(q.status) };
}
