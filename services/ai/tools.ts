import { z, ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { ToolDefinition } from "@/services/ai/llm";
import { updateCustomer } from "@/services/customers";
import { createPartRequest } from "@/services/inventory/requests";
import { applyOptionDisplayMode, searchParts, type PartMatch } from "@/services/inventory/search";
import { listLabourRates, labourLineDefaults } from "@/services/labour";
import { createQuotation, getQuotationFull, submitForApproval, updateQuotation, type QuoteItemInput, type QuoteLabourInput } from "@/services/quotes/service";
import { createVehicle, describeVehicle, updateVehicle } from "@/services/vehicles";
import { evaluatePartFit, normalizeMake, normalizeText, vehicleHasIdentity, type FitmentSpec } from "@/services/vehicles/matching";
import { requestHuman } from "@/services/conversations";
import { formatMoney, toNumber } from "@/utils/money";
import { validateVin } from "@/utils/vin";
import type { AiActor } from "@/types/actor";

/**
 * The ONLY capabilities the AI has. Each tool is bound to one business and one
 * conversation by the server (the model never supplies either), validates its
 * own arguments, and calls the same permission-checked services as the dashboard.
 * There is no SQL access, no approval tool and no send tool.
 */
export interface ToolContext {
  businessId: string;
  conversationId: string;
}

export type ToolResult = Record<string, unknown>;

interface ToolSpec {
  def: ToolDefinition;
  schema: z.ZodTypeAny;
  run: (ctx: ToolContext, args: never) => Promise<ToolResult>;
}

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

function actorFor(ctx: ToolContext): AiActor {
  return { kind: "ai", businessId: ctx.businessId, conversationId: ctx.conversationId };
}

async function loadConversation(ctx: ToolContext) {
  const conv = await db.conversation.findFirst({
    where: { id: ctx.conversationId, businessId: ctx.businessId },
    include: { customer: true, vehicle: true, business: true },
  });
  if (!conv) throw new AppError("NOT_FOUND", "Conversation not found", 404);
  return conv;
}

function vehicleView(v: NonNullable<Awaited<ReturnType<typeof loadConversation>>["vehicle"]> | null) {
  if (!v) return null;
  return {
    id: v.id,
    description: describeVehicle(v),
    make: v.make, model: v.model, year: v.year, variant: v.variant, engine: v.engine, engine_size: v.engineSize,
    engine_code: v.engineCode, fuel_type: v.fuelType, transmission: v.transmission, vin: v.vin,
    registration_number: v.registrationNumber, mileage: v.mileage, vin_decoded: v.vinDecoded,
  };
}

function vehicleMissing(v: ReturnType<typeof vehicleView>) {
  const missing: string[] = [];
  if (!v?.make) missing.push("make");
  if (!v?.model) missing.push("model");
  if (!v?.year) missing.push("year");
  return missing;
}

function matchView(m: PartMatch, sym: string) {
  return {
    part_id: m.part.id,
    name: m.part.name,
    part_number: m.part.partNumber,
    sku: m.part.sku,
    manufacturer: m.part.manufacturer,
    category: m.part.category,
    indicative_price: formatMoney(m.part.sellingPrice, sym),
    stock: { availability: m.availability, quantity: m.part.quantityInStock },
    fitment: {
      status: m.fit.status,
      confidence: m.fit.confidence,
      unverified_vehicle_details: m.fit.unverified,
      notes: m.fit.notes ?? null,
    },
    label: m.label ?? null,
    warnings: m.notes,
  };
}

async function fitOf(ctx: ToolContext, partId: string) {
  const conv = await loadConversation(ctx);
  const part = await db.part.findFirst({ where: { id: partId, businessId: ctx.businessId }, include: { fitments: true } });
  if (!part) throw new AppError("NOT_FOUND", "Part not found in inventory", 404);
  const fit = evaluatePartFit(
    conv.vehicle,
    part,
    part.fitments.map<FitmentSpec>((f) => ({ ...f })),
  );
  return { conv, part, fit };
}

function quoteView(q: Awaited<ReturnType<typeof getQuotationFull>>, sym: string) {
  return {
    quote_id: q.id,
    quote_number: q.quoteNumber,
    status: q.status,
    awaiting_business_approval: q.status === "PENDING_APPROVAL",
    sent_to_customer: q.status === "SENT",
    parts: q.items.map((i) => ({
      part_id: i.partId, description: i.description, quantity: toNumber(i.quantity), line_total: formatMoney(i.total, sym),
      fitment_confidence: i.fitmentConfidence, note: i.matchNote,
    })),
    labour: q.labour.map((l) => ({ description: l.description, hours: toNumber(l.hours), line_total: formatMoney(l.total, sym) })),
    indicative_total: formatMoney(q.total, sym),
    note: "Indicative only. The business reviews and may change prices before the official quotation is sent.",
  };
}

async function buildQuoteLines(
  ctx: ToolContext,
  conv: Awaited<ReturnType<typeof loadConversation>>,
  args: { items?: { part_id: string; quantity: number }[]; labour?: { labour_rate_id: string; hours?: number }[] },
) {
  if (!vehicleHasIdentity(conv.vehicle) || !conv.vehicle?.model) {
    throw new AppError("VALIDATION", "MISSING_VEHICLE: the vehicle make and model must be known before quoting. Ask the customer.", 400);
  }
  const items: QuoteItemInput[] = [];
  for (const line of args.items ?? []) {
    const { part, fit } = await fitOf(ctx, line.part_id);
    if (!part.active) throw new AppError("VALIDATION", `PART_INACTIVE: ${part.name} is no longer available.`, 400);
    if (fit.status === "CONFLICT") {
      throw new AppError("VALIDATION", `FITMENT_CONFLICT: ${part.name} does not fit this vehicle according to the fitment database. Do not quote it.`, 400);
    }
    if (part.quantityInStock <= 0) {
      throw new AppError("VALIDATION", `OUT_OF_STOCK: ${part.name} is out of stock. Use request_part so the business can check availability.`, 400);
    }
    if (part.quantityInStock < line.quantity) {
      throw new AppError("VALIDATION", `INSUFFICIENT_STOCK: only ${part.quantityInStock} of ${part.name} in stock (requested ${line.quantity}).`, 400);
    }

    const notes: string[] = [];
    if (fit.status === "NO_DATA") notes.push("No fitment data on file - verify compatibility");
    if (fit.status === "UNIVERSAL") notes.push("Universal part");
    if (fit.status === "FITMENT" && fit.unverified.length) notes.push(`Unverified vehicle details: ${fit.unverified.join(", ")}`);
    if (fit.notes) notes.push(fit.notes);

    // Surface other compatible options in the same category so the business can choose.
    let alternatives: Prisma.InputJsonValue | null = null;
    if (part.category) {
      const others = await searchParts({ businessId: ctx.businessId, category: part.category, vehicle: conv.vehicle, limit: 10 });
      const alts = others.matches
        .filter((m) => m.part.id !== part.id && m.fit.status !== "NO_DATA" && normalizeText(m.part.category) === normalizeText(part.category))
        .slice(0, 5)
        .map((m) => ({
          partId: m.part.id, name: m.part.name, partNumber: m.part.partNumber, sku: m.part.sku,
          manufacturer: m.part.manufacturer, sellingPrice: m.part.sellingPrice, stock: m.part.quantityInStock, confidence: m.fit.confidence,
        }));
      if (alts.length) {
        alternatives = alts;
        notes.push(`${alts.length} other compatible option${alts.length > 1 ? "s" : ""} in this category - confirm the choice`);
      }
    }
    items.push({
      partId: part.id,
      quantity: line.quantity,
      fitmentConfidence: String(fit.confidence),
      matchNote: notes.join("; ") || null,
      alternatives,
    });
  }
  const labour: QuoteLabourInput[] = (args.labour ?? []).map((l) => ({ labourId: l.labour_rate_id, hours: l.hours }));
  return { items, labour };
}

const partLine = z.object({ part_id: z.string().min(1), quantity: z.number().int().min(1).max(100) });
const labourLine = z.object({ labour_rate_id: z.string().min(1), hours: z.number().positive().max(100).optional() });

const vehicleFields = z.object({
  make: z.string().max(60).optional(),
  model: z.string().max(80).optional(),
  year: z.number().int().min(1950).max(2100).optional(),
  variant: z.string().max(80).optional(),
  engine: z.string().max(80).optional(),
  engine_size: z.string().max(20).optional(),
  engine_code: z.string().max(30).optional(),
  fuel_type: z.string().max(30).optional(),
  transmission: z.string().max(30).optional(),
  vin: z.string().max(40).optional(),
  registration_number: z.string().max(20).optional(),
  mileage: z.number().int().min(0).max(2_000_000).optional(),
});

const vehicleProps = {
  make: str("Vehicle make, e.g. Volkswagen"),
  model: str("Model, e.g. Golf 7"),
  year: num("Model year"),
  variant: str("Variant/trim, e.g. Comfortline, GTI"),
  engine: str("Engine, e.g. 1.4 TSI"),
  engine_size: str("Engine size in litres, e.g. 1.4"),
  engine_code: str("Engine code if known, e.g. CZCA"),
  fuel_type: str("petrol, diesel, hybrid, electric"),
  transmission: str("manual or automatic"),
  vin: str("17 character VIN"),
  registration_number: str("Registration/plate number"),
  mileage: num("Odometer reading in km"),
};

function vehicleInput(a: z.infer<typeof vehicleFields>) {
  return {
    make: a.make, model: a.model, year: a.year, variant: a.variant, engine: a.engine, engineSize: a.engine_size,
    engineCode: a.engine_code, fuelType: a.fuel_type, transmission: a.transmission, registrationNumber: a.registration_number,
    mileage: a.mileage,
  };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const TOOLS: Record<string, ToolSpec> = {
  get_customer: {
    def: {
      name: "get_customer",
      description: "Get what is known about the customer in this conversation (name, email, contact preference).",
      parameters: obj({}),
    },
    schema: z.object({}).strict(),
    async run(ctx) {
      const { customer } = await loadConversation(ctx);
      return {
        customer: { name: customer.name, phone: `+${customer.phone}`, email: customer.email, preferred_contact_method: customer.preferredContactMethod },
        missing: customer.name ? [] : ["name"],
      };
    },
  },

  create_customer: {
    def: {
      name: "create_customer",
      description:
        "Store customer details for this conversation. The customer record already exists (created from their WhatsApp number), so this simply saves the name/email they give you. Same as update_customer.",
      parameters: obj({ name: str("Customer full name"), email: str("Email address (optional)") }),
    },
    schema: z.object({ name: z.string().max(120).optional(), email: z.string().email().max(160).optional(), preferred_contact_method: z.enum(["WHATSAPP", "EMAIL", "PHONE"]).optional() }),
    async run(ctx, args: { name?: string; email?: string; preferred_contact_method?: "WHATSAPP" | "EMAIL" | "PHONE" }) {
      return TOOLS.update_customer.run(ctx, args as never);
    },
  },

  update_customer: {
    def: {
      name: "update_customer",
      description: "Update the customer's name, email or preferred contact method.",
      parameters: obj({
        name: str("Customer full name"),
        email: str("Email address"),
        preferred_contact_method: { type: "string", enum: ["WHATSAPP", "EMAIL", "PHONE"] },
      }),
    },
    schema: z.object({ name: z.string().max(120).optional(), email: z.string().email().max(160).optional(), preferred_contact_method: z.enum(["WHATSAPP", "EMAIL", "PHONE"]).optional() }),
    async run(ctx, args: { name?: string; email?: string; preferred_contact_method?: "WHATSAPP" | "EMAIL" | "PHONE" }) {
      const conv = await loadConversation(ctx);
      const updated = await updateCustomer(actorFor(ctx), conv.customerId, {
        name: args.name,
        email: args.email,
        preferredContactMethod: args.preferred_contact_method,
      });
      return { ok: true, customer: { name: updated.name, email: updated.email, preferred_contact_method: updated.preferredContactMethod } };
    },
  },

  get_vehicle: {
    def: {
      name: "get_vehicle",
      description: "Get the vehicle currently attached to this conversation and which key details are still missing.",
      parameters: obj({}),
    },
    schema: z.object({}).strict(),
    async run(ctx) {
      const conv = await loadConversation(ctx);
      const v = vehicleView(conv.vehicle);
      return { vehicle: v, missing_for_parts_search: v ? vehicleMissing(v) : ["make", "model", "year"] };
    },
  },

  create_vehicle: {
    def: {
      name: "create_vehicle",
      description:
        "Save the vehicle the customer is asking about and attach it to this conversation. If a vehicle is already attached and this is the same make/model (or no make is given) the existing record is updated instead of duplicated. Only pass details the customer actually told you. A supplied VIN is validated and decoded when a decoder is available.",
      parameters: obj(vehicleProps),
    },
    schema: vehicleFields,
    async run(ctx, args: z.infer<typeof vehicleFields>) {
      const conv = await loadConversation(ctx);
      const actor = actorFor(ctx);
      const input = stripUndefined(vehicleInput(args));

      let vinError: string | undefined;
      let vin: string | undefined;
      if (args.vin) {
        const v = validateVin(args.vin);
        if (v.valid) vin = v.vin;
        else vinError = v.reason;
      }

      const existing = conv.vehicle;
      const sameCar =
        existing &&
        (!args.make || normalizeMake(args.make) === normalizeMake(existing.make)) &&
        (!args.model || !existing.model || normalizeText(args.model) === normalizeText(existing.model));

      let vehicleId: string;
      if (existing && sameCar) {
        await updateVehicle(actor, existing.id, { ...input, vin });
        vehicleId = existing.id;
      } else {
        if (vin) {
          const dup = await db.vehicle.findFirst({ where: { businessId: ctx.businessId, customerId: conv.customerId, vin } });
          if (dup) {
            await updateVehicle(actor, dup.id, input);
            vehicleId = dup.id;
            await db.conversation.update({ where: { id: conv.id }, data: { vehicleId } });
            const fresh = await loadConversation(ctx);
            return { ok: true, vehicle: vehicleView(fresh.vehicle), vin_error: vinError ?? null };
          }
        }
        const created = await createVehicle(actor, { ...input, vin, customerId: conv.customerId });
        vehicleId = created.id;
        await db.conversation.update({ where: { id: conv.id }, data: { vehicleId } });
      }
      const fresh = await loadConversation(ctx);
      const v = vehicleView(fresh.vehicle);
      return { ok: true, vehicle: v, missing_for_parts_search: vehicleMissing(v), vin_error: vinError ?? null };
    },
  },

  update_vehicle: {
    def: {
      name: "update_vehicle",
      description:
        "Update details of the vehicle attached to this conversation (e.g. after the customer supplies year, engine, VIN or registration). Invalid VINs are rejected with an explanation you can relay.",
      parameters: obj(vehicleProps),
    },
    schema: vehicleFields,
    async run(ctx, args: z.infer<typeof vehicleFields>) {
      const conv = await loadConversation(ctx);
      if (!conv.vehicle) return TOOLS.create_vehicle.run(ctx, args as never);
      let vinError: string | undefined;
      let vin: string | undefined;
      if (args.vin) {
        const v = validateVin(args.vin);
        if (v.valid) vin = v.vin;
        else vinError = v.reason;
      }
      await updateVehicle(actorFor(ctx), conv.vehicle.id, { ...stripUndefined(vehicleInput(args)), vin });
      const fresh = await loadConversation(ctx);
      const v = vehicleView(fresh.vehicle);
      return { ok: true, vehicle: v, missing_for_parts_search: vehicleMissing(v), vin_error: vinError ?? null };
    },
  },

  search_parts: {
    def: {
      name: "search_parts",
      description:
        "Search this business's inventory for parts that fit the conversation's vehicle. Results come from the inventory and fitment database only. Requires the vehicle make (and ideally model and year) unless you pass an exact part_number. Returns the options the business allows customers to see.",
      parameters: obj(
        {
          query: str("What the customer needs, e.g. 'front brake pads'"),
          category: str("Optional category filter"),
          part_number: str("Optional exact part number or SKU"),
        },
        ["query"],
      ),
    },
    schema: z.object({ query: z.string().min(1).max(200), category: z.string().max(80).optional(), part_number: z.string().max(80).optional() }),
    async run(ctx, args: { query: string; category?: string; part_number?: string }) {
      const conv = await loadConversation(ctx);
      const sym = conv.business.currencySymbol;
      if (!vehicleHasIdentity(conv.vehicle) && !args.part_number) {
        return {
          ok: false,
          vehicle_known: false,
          message: "The vehicle is not identified yet. Ask what car it is (make, model, year) before searching.",
        };
      }
      const result = await searchParts({
        businessId: ctx.businessId,
        query: args.query,
        category: args.category,
        partNumber: args.part_number,
        vehicle: conv.vehicle,
        limit: 15,
      });
      const { visible, hidden, businessWillConfirm } = applyOptionDisplayMode(result.matches, conv.business.optionDisplayMode);
      return {
        ok: true,
        vehicle: conv.vehicle ? describeVehicle(conv.vehicle) : null,
        option_display_mode: conv.business.optionDisplayMode,
        no_match: result.matches.length === 0,
        results: visible.map((m) => matchView(m, sym)),
        hidden_options: hidden,
        multiple_options_available: result.multipleOptions,
        business_will_confirm_choice: businessWillConfirm,
        ask_customer_about: result.missingVehicleInfo,
        confirm_with_customer: result.confirmVehicleInfo,
        excluded_because_they_do_not_fit: result.excludedByFitment,
        guidance:
          result.matches.length === 0
            ? "Nothing suitable found. Tell the customer you could not find it in current stock and call request_part."
            : "Only describe the parts listed in results. Prices are indicative until the business approves the quotation. Never call anything 'best' unless label says Recommended.",
      };
    },
  },

  check_part_fitment: {
    def: {
      name: "check_part_fitment",
      description: "Check whether a specific part fits the conversation's vehicle according to the fitment database.",
      parameters: obj({ part_id: str("Part id from search_parts") }, ["part_id"]),
    },
    schema: z.object({ part_id: z.string().min(1) }),
    async run(ctx, args: { part_id: string }) {
      const { part, fit } = await fitOf(ctx, args.part_id);
      return {
        part: part.name,
        status: fit.status,
        confidence: fit.confidence,
        fits: fit.status !== "CONFLICT",
        unverified_vehicle_details: fit.unverified,
        conflicting_details: fit.status === "CONFLICT" ? [...new Set((fit.rejections ?? []).flatMap((r) => r.conflicts))] : [],
        notes: fit.notes ?? null,
      };
    },
  },

  check_stock: {
    def: {
      name: "check_stock",
      description: "Check current stock for a part.",
      parameters: obj({ part_id: str("Part id"), quantity: num("Quantity needed (default 1)") }, ["part_id"]),
    },
    schema: z.object({ part_id: z.string().min(1), quantity: z.number().int().min(1).max(100).optional() }),
    async run(ctx, args: { part_id: string; quantity?: number }) {
      const part = await db.part.findFirst({ where: { id: args.part_id, businessId: ctx.businessId } });
      if (!part || !part.active) throw new AppError("NOT_FOUND", "Part not found in inventory", 404);
      const need = args.quantity ?? 1;
      return { part: part.name, in_stock: part.quantityInStock, requested: need, enough_stock: part.quantityInStock >= need };
    },
  },

  get_labour_rates: {
    def: {
      name: "get_labour_rates",
      description: "List the business's labour rates (e.g. brake replacement, diagnostic inspection) that can be added to a quotation.",
      parameters: obj({}),
    },
    schema: z.object({}).strict(),
    async run(ctx) {
      const conv = await loadConversation(ctx);
      const sym = conv.business.currencySymbol;
      const rates = await listLabourRates(ctx.businessId);
      return {
        labour_rates: rates.map((r) => {
          const d = labourLineDefaults(r);
          return {
            labour_rate_id: r.id,
            name: r.name,
            description: r.description,
            pricing: r.fixedPrice && !r.hourlyRate ? `${formatMoney(r.fixedPrice, sym)} fixed` : `${formatMoney(r.hourlyRate, sym)}/hour`,
            default_hours: d.hours,
            indicative_price: formatMoney(d.hours * d.unitPrice, sym),
          };
        }),
      };
    },
  },

  create_quote: {
    def: {
      name: "create_quote",
      description:
        "Create a DRAFT quotation for this conversation's customer and vehicle from parts found with search_parts and labour from get_labour_rates. Prices always come from the business's price list; you cannot set or change them. Out-of-stock parts and parts that do not fit are rejected. Afterwards call submit_quote_for_approval.",
      parameters: obj(
        {
          items: { type: "array", items: obj({ part_id: str("Part id"), quantity: num("Quantity") }, ["part_id", "quantity"]) },
          labour: { type: "array", items: obj({ labour_rate_id: str("Labour rate id"), hours: num("Hours (optional)") }, ["labour_rate_id"]) },
          notes_for_business: str("Internal note for the business: what the customer asked for, symptoms described, anything to double check. Never shown to the customer."),
        },
        [],
      ),
    },
    schema: z.object({ items: z.array(partLine).max(30).optional(), labour: z.array(labourLine).max(10).optional(), notes_for_business: z.string().max(2000).optional() }),
    async run(ctx, args: { items?: { part_id: string; quantity: number }[]; labour?: { labour_rate_id: string; hours?: number }[]; notes_for_business?: string }) {
      if (!args.items?.length && !args.labour?.length) {
        throw new AppError("VALIDATION", "A quotation needs at least one part or labour line", 400);
      }
      const conv = await loadConversation(ctx);
      const { items, labour } = await buildQuoteLines(ctx, conv, args);
      try {
        const q = await createQuotation(actorFor(ctx), {
          customerId: conv.customerId,
          vehicleId: conv.vehicleId,
          conversationId: conv.id,
          items,
          labour,
          internalNotes: args.notes_for_business,
          source: "AI",
        });
        await db.conversation.updateMany({ where: { id: conv.id, status: "ACTIVE" }, data: { status: "QUOTE_PENDING" } });
        return { ok: true, ...quoteView(q, conv.business.currencySymbol), next_step: "Call submit_quote_for_approval when the customer has confirmed what they want quoted." };
      } catch (e) {
        if (e instanceof AppError && e.code === "CONFLICT") {
          return { ok: false, error: "QUOTE_ALREADY_EXISTS", message: e.message, existing_quote_id: (e.details as { quotationId?: string })?.quotationId, hint: "Use update_quote to change the existing draft, or get_quote to look at it." };
        }
        throw e;
      }
    },
  },

  update_quote: {
    def: {
      name: "update_quote",
      description:
        "Replace the parts/labour on this conversation's DRAFT quotation. Only drafts that have not yet been submitted for approval can be changed. Prices still come from the price list.",
      parameters: obj({
        quote_id: str("Quote id (optional; defaults to this conversation's open quote)"),
        items: { type: "array", items: obj({ part_id: str("Part id"), quantity: num("Quantity") }, ["part_id", "quantity"]) },
        labour: { type: "array", items: obj({ labour_rate_id: str("Labour rate id"), hours: num("Hours") }, ["labour_rate_id"]) },
        notes_for_business: str("Internal note for the business"),
      }),
    },
    schema: z.object({ quote_id: z.string().optional(), items: z.array(partLine).max(30).optional(), labour: z.array(labourLine).max(10).optional(), notes_for_business: z.string().max(2000).optional() }),
    async run(ctx, args: { quote_id?: string; items?: { part_id: string; quantity: number }[]; labour?: { labour_rate_id: string; hours?: number }[]; notes_for_business?: string }) {
      const conv = await loadConversation(ctx);
      const current = await findConversationQuote(ctx, args.quote_id);
      if (current.status !== "DRAFT") {
        return { ok: false, error: "QUOTE_LOCKED", message: `The quotation is ${current.status} and can no longer be changed by you. The business will handle changes.` };
      }
      const lines = args.items || args.labour ? await buildQuoteLines(ctx, conv, args) : { items: undefined, labour: undefined };
      const q = await updateQuotation(actorFor(ctx), current.id, {
        items: args.items ? lines.items : undefined,
        labour: args.labour ? lines.labour : undefined,
        internalNotes: args.notes_for_business,
      });
      return { ok: true, ...quoteView(q, conv.business.currencySymbol) };
    },
  },

  get_quote: {
    def: {
      name: "get_quote",
      description: "Get the current quotation for this conversation (status and lines).",
      parameters: obj({ quote_id: str("Quote id (optional)") }),
    },
    schema: z.object({ quote_id: z.string().optional() }),
    async run(ctx, args: { quote_id?: string }) {
      const conv = await loadConversation(ctx);
      const q = await findConversationQuote(ctx, args.quote_id, true);
      if (!q) return { ok: true, quote: null };
      return { ok: true, ...quoteView(q, conv.business.currencySymbol) };
    },
  },

  submit_quote_for_approval: {
    def: {
      name: "submit_quote_for_approval",
      description:
        "Send the DRAFT quotation to the business for review. This does NOT send anything to the customer: the business approves (and may edit) it first, and then the official PDF is sent automatically. Tell the customer the team will review it and send the quotation shortly.",
      parameters: obj({ quote_id: str("Quote id (optional)") }),
    },
    schema: z.object({ quote_id: z.string().optional() }),
    async run(ctx, args: { quote_id?: string }) {
      const conv = await loadConversation(ctx);
      const current = await findConversationQuote(ctx, args.quote_id);
      const q = await submitForApproval(actorFor(ctx), current.id);
      return {
        ok: true,
        ...quoteView(q, conv.business.currencySymbol),
        message: "Submitted for business approval. The customer has NOT received a quotation yet.",
      };
    },
  },

  request_part: {
    def: {
      name: "request_part",
      description:
        "Log a part request for the business when you could not find a suitable in-stock part. The business will check availability and respond manually.",
      parameters: obj({ description: str("The part the customer wants, including position/side if relevant"), notes: str("Extra context (symptoms, urgency)") }, ["description"]),
    },
    schema: z.object({ description: z.string().min(2).max(300), notes: z.string().max(1000).optional() }),
    async run(ctx, args: { description: string; notes?: string }) {
      const conv = await loadConversation(ctx);
      const { request, created } = await createPartRequest(actorFor(ctx), {
        description: args.description,
        notes: args.notes,
        customerId: conv.customerId,
        vehicleId: conv.vehicleId,
        conversationId: conv.id,
      });
      return { ok: true, part_request_id: request.id, already_logged: !created, message: "The business has been notified and will check availability." };
    },
  },

  request_human_handoff: {
    def: {
      name: "request_human_handoff",
      description:
        "Hand the conversation to a human when the customer asks to speak to someone, is upset, or asks for something you cannot do. Automated replies stop after this.",
      parameters: obj({ reason: str("Why a human is needed") }, ["reason"]),
    },
    schema: z.object({ reason: z.string().min(2).max(300) }),
    async run(ctx, args: { reason: string }) {
      await requestHuman(actorFor(ctx), ctx.conversationId, args.reason);
      return { ok: true, message: "The conversation is flagged for a team member. Tell the customer someone will be in touch." };
    },
  },
};

async function findConversationQuote(ctx: ToolContext, quoteId?: string, optional?: false): Promise<Awaited<ReturnType<typeof getQuotationFull>>>;
async function findConversationQuote(ctx: ToolContext, quoteId: string | undefined, optional: true): Promise<Awaited<ReturnType<typeof getQuotationFull>> | null>;
async function findConversationQuote(ctx: ToolContext, quoteId?: string, optional = false) {
  const row = await db.quotation.findFirst({
    where: {
      businessId: ctx.businessId,
      conversationId: ctx.conversationId,
      ...(quoteId ? { id: quoteId } : { status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"] } }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!row) {
    if (optional) return null;
    throw new AppError("NOT_FOUND", "No quotation exists for this conversation yet", 404);
  }
  return getQuotationFull(ctx.businessId, row.id);
}

export const toolDefinitions: ToolDefinition[] = Object.values(TOOLS).map((t) => t.def);

/** Execute one tool call. Never throws: failures are returned to the model as structured errors. */
export async function executeTool(ctx: ToolContext, name: string, rawArgs: string): Promise<ToolResult> {
  const tool = TOOLS[name];
  if (!tool) return { ok: false, error: "UNKNOWN_TOOL", message: `There is no tool called ${name}` };
  let parsed: unknown;
  try {
    parsed = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { ok: false, error: "INVALID_ARGUMENTS", message: "Arguments must be valid JSON" };
  }
  try {
    const args = tool.schema.parse(parsed);
    return await tool.run(ctx, args as never);
  } catch (e) {
    if (e instanceof ZodError) {
      return { ok: false, error: "INVALID_ARGUMENTS", message: e.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ") };
    }
    if (e instanceof AppError) return { ok: false, error: e.code, message: e.message };
    console.error(`[ai-tool:${name}]`, e);
    return { ok: false, error: "INTERNAL", message: "The tool failed unexpectedly. Do not retry; hand over to a human if needed." };
  }
}
