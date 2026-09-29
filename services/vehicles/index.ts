import type { Prisma, Vehicle } from "@prisma/client";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/services/audit";
import type { Actor } from "@/types/actor";
import { getVehicleDecoder, type VinDecodeResult } from "@/services/vehicles/decoder";
import { validateVin } from "@/utils/vin";

export interface VehicleInput {
  customerId?: string | null;
  vin?: string | null;
  registrationNumber?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  variant?: string | null;
  engine?: string | null;
  engineCode?: string | null;
  engineSize?: string | null;
  fuelType?: string | null;
  transmission?: string | null;
  mileage?: number | null;
}

const TEXT_FIELDS = [
  "registrationNumber", "make", "model", "variant", "engine", "engineCode", "engineSize", "fuelType", "transmission",
] as const;

function clean(input: VehicleInput): Prisma.VehicleUncheckedUpdateInput {
  const data: Prisma.VehicleUncheckedUpdateInput = {};
  for (const f of TEXT_FIELDS) {
    if (input[f] !== undefined) {
      const v = input[f]?.toString().trim();
      data[f] = v ? (f === "registrationNumber" ? v.toUpperCase() : v) : null;
    }
  }
  if (input.year !== undefined) {
    if (input.year !== null && (!Number.isInteger(input.year) || input.year < 1900 || input.year > new Date().getFullYear() + 1)) {
      throw new ValidationError("Enter a valid vehicle year");
    }
    data.year = input.year;
  }
  if (input.mileage !== undefined) {
    if (input.mileage !== null && (!Number.isInteger(input.mileage) || input.mileage < 0)) {
      throw new ValidationError("Mileage must be a positive whole number");
    }
    data.mileage = input.mileage;
  }
  if (input.customerId !== undefined) data.customerId = input.customerId;
  return data;
}

async function assertCustomer(businessId: string, customerId?: string | null) {
  if (!customerId) return;
  const c = await db.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } });
  if (!c) throw new NotFoundError("Customer");
}

export interface VinApplyResult {
  vehicle: Vehicle;
  decode: VinDecodeResult;
}

/**
 * Validate and store a VIN, then enrich the vehicle with decoder output. Values
 * already provided by the customer/business are never overwritten by the decoder.
 */
export async function applyVin(actor: Actor, vehicleId: string, vinInput: string): Promise<VinApplyResult> {
  const v = validateVin(vinInput);
  if (!v.valid) throw new ValidationError(v.reason ?? "Invalid VIN");
  const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, businessId: actor.businessId } });
  if (!vehicle) throw new NotFoundError("Vehicle");

  const decode = await getVehicleDecoder().decode(v.vin);
  const data: Prisma.VehicleUncheckedUpdateInput = { vin: v.vin };
  if (decode.decoded) {
    const a = decode.attributes;
    if (!vehicle.make && a.make) data.make = a.make;
    if (!vehicle.model && a.model) data.model = a.model;
    if (!vehicle.year && a.year) data.year = a.year;
    if (!vehicle.variant && a.variant) data.variant = a.variant;
    if (!vehicle.engine && a.engine) data.engine = a.engine;
    if (!vehicle.engineSize && a.engineSize) data.engineSize = a.engineSize;
    if (!vehicle.engineCode && a.engineCode) data.engineCode = a.engineCode;
    if (!vehicle.fuelType && a.fuelType) data.fuelType = a.fuelType;
    if (!vehicle.transmission && a.transmission) data.transmission = a.transmission;
    data.vinDecoded = true;
  }
  const updated = await db.vehicle.update({ where: { id: vehicleId }, data });
  await audit(actor, {
    action: "vehicle.vin",
    entityType: "Vehicle",
    entityId: vehicleId,
    summary: `VIN ${v.vin} stored${decode.decoded ? ` (decoded via ${decode.provider})` : ""}`,
  });
  return { vehicle: updated, decode };
}

export async function createVehicle(actor: Actor, input: VehicleInput): Promise<Vehicle> {
  await assertCustomer(actor.businessId, input.customerId);
  const { vin, ...rest } = input;
  const data = clean(rest);
  const created = await db.vehicle.create({
    data: { ...(data as Prisma.VehicleUncheckedCreateInput), businessId: actor.businessId },
  });
  await audit(actor, { action: "vehicle.create", entityType: "Vehicle", entityId: created.id, summary: describeVehicle(created) });
  if (vin) return (await applyVin(actor, created.id, vin)).vehicle;
  return created;
}

export async function updateVehicle(actor: Actor, id: string, input: VehicleInput): Promise<Vehicle> {
  const existing = await db.vehicle.findFirst({ where: { id, businessId: actor.businessId } });
  if (!existing) throw new NotFoundError("Vehicle");
  await assertCustomer(actor.businessId, input.customerId);
  const { vin, ...rest } = input;
  const data = clean(rest);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(data)) {
    const from = (existing as Record<string, unknown>)[k];
    if (from !== v) changes[k] = { from, to: v };
  }
  let updated = existing;
  if (Object.keys(changes).length) {
    updated = await db.vehicle.update({ where: { id }, data });
    await audit(actor, {
      action: "vehicle.update",
      entityType: "Vehicle",
      entityId: id,
      summary: `${describeVehicle(updated)} updated (${Object.keys(changes).join(", ")})`,
      details: changes as Prisma.InputJsonValue,
    });
  }
  if (vin && vin !== existing.vin) updated = (await applyVin(actor, id, vin)).vehicle;
  return updated;
}

export async function getVehicle(businessId: string, id: string) {
  const v = await db.vehicle.findFirst({ where: { id, businessId }, include: { customer: true } });
  if (!v) throw new NotFoundError("Vehicle");
  return v;
}

export async function listVehicles(
  businessId: string,
  opts: { q?: string; customerId?: string; page?: number; pageSize?: number } = {},
) {
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const q = opts.q?.trim();
  const where: Prisma.VehicleWhereInput = {
    businessId,
    ...(opts.customerId ? { customerId: opts.customerId } : {}),
    ...(q
      ? {
          OR: [
            { make: { contains: q, mode: "insensitive" } },
            { model: { contains: q, mode: "insensitive" } },
            { vin: { contains: q, mode: "insensitive" } },
            { registrationNumber: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.vehicle.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { customer: { select: { id: true, name: true, phone: true } } },
    }),
    db.vehicle.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export function describeVehicle(v: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  engine?: string | null;
  engineSize?: string | null;
}): string {
  const engine = v.engine ?? v.engineSize ?? "";
  const parts = [v.year, v.make, v.model, v.variant, engine].filter(Boolean);
  return parts.length ? parts.join(" ") : "Vehicle (details pending)";
}
