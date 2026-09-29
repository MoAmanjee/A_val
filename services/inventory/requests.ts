import type { PartRequestStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/services/audit";
import type { Actor } from "@/types/actor";

export async function createPartRequest(
  actor: Actor,
  input: { description: string; notes?: string | null; customerId?: string | null; vehicleId?: string | null; conversationId?: string | null },
) {
  const description = input.description.trim();
  if (!description) throw new ValidationError("Describe the part that was requested");
  if (input.conversationId) {
    const dup = await db.partRequest.findFirst({
      where: {
        businessId: actor.businessId,
        conversationId: input.conversationId,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        description: { equals: description, mode: "insensitive" },
      },
    });
    if (dup) return { request: dup, created: false };
  }
  const request = await db.partRequest.create({
    data: {
      businessId: actor.businessId,
      description,
      notes: input.notes?.trim() || null,
      customerId: input.customerId ?? null,
      vehicleId: input.vehicleId ?? null,
      conversationId: input.conversationId ?? null,
    },
  });
  await audit(actor, { action: "part_request.create", entityType: "PartRequest", entityId: request.id, summary: `Part request: ${description}` });
  return { request, created: true };
}

export async function listPartRequests(businessId: string, opts: { status?: PartRequestStatus | "ACTIVE"; page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(opts.pageSize ?? 50, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const where = {
    businessId,
    ...(opts.status === "ACTIVE" ? { status: { in: ["OPEN", "IN_PROGRESS"] as PartRequestStatus[] } } : opts.status ? { status: opts.status } : {}),
  };
  const [items, total] = await Promise.all([
    db.partRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        vehicle: { select: { id: true, year: true, make: true, model: true, variant: true, engine: true } },
      },
    }),
    db.partRequest.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function updatePartRequest(actor: Actor, id: string, patch: { status?: PartRequestStatus; notes?: string | null }) {
  const existing = await db.partRequest.findFirst({ where: { id, businessId: actor.businessId } });
  if (!existing) throw new NotFoundError("Part request");
  const updated = await db.partRequest.update({
    where: { id },
    data: { ...(patch.status ? { status: patch.status } : {}), ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}) },
  });
  await audit(actor, { action: "part_request.update", entityType: "PartRequest", entityId: id, summary: `Part request "${existing.description}" -> ${updated.status}` });
  return updated;
}
