import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { actorLabel, actorUserId, type Actor } from "@/types/actor";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  details?: Prisma.InputJsonValue;
}

/**
 * Append an entry to the audit log. Pass a transaction client so the audit row
 * commits atomically with the change it describes.
 */
export async function audit(actor: Actor, entry: AuditEntry, tx: Tx = db) {
  return tx.auditLog.create({
    data: {
      businessId: actor.businessId,
      userId: actorUserId(actor),
      actor: actorLabel(actor),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      details: entry.details,
    },
  });
}

export async function listAuditLogs(
  businessId: string,
  opts: { entityType?: string; entityId?: string; action?: string; page?: number; pageSize?: number } = {},
) {
  const pageSize = Math.min(opts.pageSize ?? 50, 200);
  const page = Math.max(opts.page ?? 1, 1);
  const where: Prisma.AuditLogWhereInput = {
    businessId,
    ...(opts.entityType ? { entityType: opts.entityType } : {}),
    ...(opts.entityId ? { entityId: opts.entityId } : {}),
    ...(opts.action ? { action: { startsWith: opts.action } } : {}),
  };
  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true, email: true } } },
    }),
    db.auditLog.count({ where }),
  ]);
  return { items, total, page, pageSize };
}
