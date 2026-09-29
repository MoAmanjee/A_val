import { db } from "@/lib/db";
import { lowStockParts } from "@/services/inventory";
import { expireOverdueQuotes } from "@/services/quotes/service";
import { toNumber } from "@/utils/money";

export async function getDashboardStats(businessId: string) {
  await expireOverdueQuotes(businessId);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [quotesToday, pendingApproval, sent, accepted, quotedAgg, sendFailed, humanRequired, openPartRequests] = await Promise.all([
    db.quotation.count({ where: { businessId, createdAt: { gte: startOfDay } } }),
    db.quotation.count({ where: { businessId, status: "PENDING_APPROVAL" } }),
    db.quotation.count({ where: { businessId, status: "SENT" } }),
    db.quotation.count({ where: { businessId, status: "ACCEPTED" } }),
    db.quotation.aggregate({
      where: { businessId, status: { in: ["APPROVED", "SENT", "ACCEPTED"] } },
      _sum: { total: true },
    }),
    db.quotation.count({ where: { businessId, status: "APPROVED", sendError: { not: null } } }),
    db.conversation.count({ where: { businessId, status: "HUMAN_REQUIRED" } }),
    db.partRequest.count({ where: { businessId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
  ]);

  const [pendingQuotes, recentConversations, recentCustomers, lowStock, humanConversations] = await Promise.all([
    db.quotation.findMany({
      where: { businessId, OR: [{ status: "PENDING_APPROVAL" }, { status: "APPROVED", sendError: { not: null } }] },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        customer: { select: { name: true, phone: true } },
        vehicle: { select: { year: true, make: true, model: true } },
      },
    }),
    db.conversation.findMany({
      where: { businessId },
      orderBy: { lastMessageAt: "desc" },
      take: 6,
      include: {
        customer: { select: { name: true, phone: true } },
        vehicle: { select: { year: true, make: true, model: true } },
        messages: { where: { messageType: { not: "NOTE" } }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.customer.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 5 }),
    lowStockParts(businessId, 6),
    db.conversation.findMany({
      where: { businessId, status: "HUMAN_REQUIRED" },
      orderBy: { humanRequestedAt: "desc" },
      take: 5,
      include: { customer: { select: { name: true, phone: true } } },
    }),
  ]);

  return {
    stats: {
      quotesToday,
      pendingApproval,
      sent,
      accepted,
      totalQuotedValue: toNumber(quotedAgg._sum.total),
      sendFailed,
      humanRequired,
      openPartRequests,
    },
    pendingQuotes,
    recentConversations,
    recentCustomers,
    lowStock,
    humanConversations,
  };
}

export async function getSidebarCounts(businessId: string) {
  const [pending, human, partRequests] = await Promise.all([
    db.quotation.count({ where: { businessId, OR: [{ status: "PENDING_APPROVAL" }, { status: "APPROVED", sendError: { not: null } }] } }),
    db.conversation.count({ where: { businessId, status: "HUMAN_REQUIRED" } }),
    db.partRequest.count({ where: { businessId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
  ]);
  return { pendingQuotes: pending, humanRequired: human, partRequests };
}
