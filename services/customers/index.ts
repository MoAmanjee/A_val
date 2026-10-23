import type { ContactMethod, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizePhone } from "@/utils/phone";
import { audit } from "@/services/audit";
import type { Actor } from "@/types/actor";

export interface CustomerInput {
  name?: string | null;
  phone: string;
  email?: string | null;
  preferredContactMethod?: ContactMethod;
}

export type CustomerPatch = Partial<Omit<CustomerInput, "phone">> & { phone?: string };

export async function listCustomers(
  businessId: string,
  opts: { q?: string; page?: number; pageSize?: number } = {},
) {
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const q = opts.q?.trim();
  const where: Prisma.CustomerWhereInput = {
    businessId,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: normalizePhone(q) || q } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { vehicles: true, quotations: true, conversations: true } } },
    }),
    db.customer.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getCustomer(businessId: string, id: string) {
  const c = await db.customer.findFirst({
    where: { id, businessId },
    include: { vehicles: true, _count: { select: { quotations: true, conversations: true } } },
  });
  if (!c) throw new NotFoundError("Customer");
  return c;
}

export async function findCustomerByPhone(businessId: string, phone: string) {
  return db.customer.findUnique({ where: { businessId_phone: { businessId, phone: normalizePhone(phone) } } });
}

/** Idempotent: returns the existing customer for this phone number if there is one. */
export async function findOrCreateCustomerByPhone(actor: Actor, phone: string, name?: string | null) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new ValidationError("A valid phone number is required");
  const existing = await findCustomerByPhone(actor.businessId, normalized);
  if (existing) return existing;
  try {
    const created = await db.customer.create({
      data: { businessId: actor.businessId, phone: normalized, name: name?.trim() || null },
    });
    await audit(actor, { action: "customer.create", entityType: "Customer", entityId: created.id, summary: `Customer created (${normalized})` });
    return created;
  } catch (e) {
    // Lost a race with a concurrent webhook for the same number.
    const again = await findCustomerByPhone(actor.businessId, normalized);
    if (again) return again;
    throw e;
  }
}

export async function createCustomer(actor: Actor, input: CustomerInput) {
  const phone = normalizePhone(input.phone);
  if (phone.length < 7) throw new ValidationError("Enter a valid phone number including country code");
  const existing = await findCustomerByPhone(actor.businessId, phone);
  if (existing) throw new ConflictError("A customer with this phone number already exists", { id: existing.id });
  const created = await db.customer.create({
    data: {
      businessId: actor.businessId,
      name: input.name?.trim() || null,
      phone,
      email: input.email?.trim() || null,
      preferredContactMethod: input.preferredContactMethod ?? "WHATSAPP",
    },
  });
  await audit(actor, { action: "customer.create", entityType: "Customer", entityId: created.id, summary: `Customer ${created.name ?? created.phone} created` });
  return created;
}

export async function updateCustomer(actor: Actor, id: string, patch: CustomerPatch) {
  const existing = await db.customer.findFirst({ where: { id, businessId: actor.businessId } });
  if (!existing) throw new NotFoundError("Customer");

  const data: Prisma.CustomerUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name?.trim() || null;
  if (patch.email !== undefined) data.email = patch.email?.trim() || null;
  if (patch.preferredContactMethod) data.preferredContactMethod = patch.preferredContactMethod;
  if (patch.phone !== undefined) {
    const phone = normalizePhone(patch.phone);
    if (phone.length < 7) throw new ValidationError("Enter a valid phone number including country code");
    if (phone !== existing.phone) {
      const clash = await findCustomerByPhone(actor.businessId, phone);
      if (clash) throw new ConflictError("Another customer already uses this phone number");
      data.phone = phone;
    }
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(data)) {
    const from = (existing as Record<string, unknown>)[k];
    if (from !== v) changes[k] = { from, to: v };
  }
  if (Object.keys(changes).length === 0) return existing;

  const updated = await db.customer.update({ where: { id }, data });
  await audit(actor, {
    action: "customer.update",
    entityType: "Customer",
    entityId: id,
    summary: `Customer ${updated.name ?? updated.phone} updated (${Object.keys(changes).join(", ")})`,
    details: changes as Prisma.InputJsonValue,
  });
  return updated;
}
