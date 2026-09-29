import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/services/audit";
import type { Actor } from "@/types/actor";
import { toNumber } from "@/utils/money";

export interface LabourRateInput {
  name: string;
  description?: string | null;
  hourlyRate?: number | null;
  fixedPrice?: number | null;
  defaultHours?: number;
  active?: boolean;
}

function clean(input: Partial<LabourRateInput>) {
  const data: Prisma.LabourRateUncheckedUpdateInput = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new ValidationError("Name is required");
    data.name = input.name.trim();
  }
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  for (const f of ["hourlyRate", "fixedPrice"] as const) {
    if (input[f] !== undefined) {
      const v = input[f];
      if (v !== null && (!Number.isFinite(v) || v < 0)) throw new ValidationError("Rates cannot be negative");
      data[f] = v === null ? null : v.toFixed(2);
    }
  }
  if (input.defaultHours !== undefined) {
    if (!(input.defaultHours > 0) || input.defaultHours > 200) throw new ValidationError("Default hours must be between 0 and 200");
    data.defaultHours = input.defaultHours.toFixed(2);
  }
  if (input.active !== undefined) data.active = input.active;
  return data;
}

export async function listLabourRates(businessId: string, opts: { includeInactive?: boolean } = {}) {
  return db.labourRate.findMany({
    where: { businessId, ...(opts.includeInactive ? {} : { active: true }) },
    orderBy: { name: "asc" },
  });
}

/** The unit price for one line: hourly rate x hours, or the fixed price (hours = 1). */
export function labourLineDefaults(rate: { hourlyRate: unknown; fixedPrice: unknown; defaultHours: unknown }, hours?: number) {
  const fixed = rate.fixedPrice === null ? null : toNumber(rate.fixedPrice as never);
  const hourly = rate.hourlyRate === null ? null : toNumber(rate.hourlyRate as never);
  if (fixed !== null && fixed > 0 && (hourly === null || hourly === 0)) return { hours: 1, unitPrice: fixed };
  return { hours: hours ?? toNumber(rate.defaultHours as never), unitPrice: hourly ?? fixed ?? 0 };
}

export async function createLabourRate(actor: Actor, input: LabourRateInput) {
  if ((input.hourlyRate ?? null) === null && (input.fixedPrice ?? null) === null) {
    throw new ValidationError("Provide an hourly rate or a fixed price");
  }
  const rate = await db.labourRate.create({
    data: { ...(clean(input) as Prisma.LabourRateUncheckedCreateInput), businessId: actor.businessId, name: input.name.trim() },
  });
  await audit(actor, { action: "labour.create", entityType: "LabourRate", entityId: rate.id, summary: `Labour rate "${rate.name}" added` });
  return rate;
}

export async function updateLabourRate(actor: Actor, id: string, input: Partial<LabourRateInput>) {
  const existing = await db.labourRate.findFirst({ where: { id, businessId: actor.businessId } });
  if (!existing) throw new NotFoundError("Labour rate");
  const rate = await db.labourRate.update({ where: { id }, data: clean(input) });
  await audit(actor, {
    action: "labour.update",
    entityType: "LabourRate",
    entityId: id,
    summary: `Labour rate "${rate.name}" updated`,
    details: { from: { hourlyRate: existing.hourlyRate?.toString() ?? null, fixedPrice: existing.fixedPrice?.toString() ?? null }, to: { hourlyRate: rate.hourlyRate?.toString() ?? null, fixedPrice: rate.fixedPrice?.toString() ?? null } },
  });
  return rate;
}

export async function deleteLabourRate(actor: Actor, id: string) {
  const existing = await db.labourRate.findFirst({ where: { id, businessId: actor.businessId } });
  if (!existing) throw new NotFoundError("Labour rate");
  await db.labourRate.delete({ where: { id } });
  await audit(actor, { action: "labour.delete", entityType: "LabourRate", entityId: id, summary: `Labour rate "${existing.name}" deleted` });
}
