"use client";

import { AlertTriangle, CheckCircle2, Clock, FileText, MessageSquare, PackageX, Send, TrendingUp, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/client";
import { CONVERSATION_STATUS, QUOTE_STATUS, dateOnly, money, num, phoneLabel, timeAgo, vehicleLabel } from "@/lib/format";

interface Stats {
  stats: { quotesToday: number; pendingApproval: number; sent: number; accepted: number; totalQuotedValue: number; sendFailed: number; humanRequired: number; openPartRequests: number };
  pendingQuotes: { id: string; quoteNumber: string; status: string; total: string; sendError: string | null; createdAt: string; customer: { name: string | null; phone: string }; vehicle: { year: number | null; make: string | null; model: string | null } | null }[];
  recentConversations: { id: string; status: string; unreadCount: number; lastMessageAt: string; customer: { name: string | null; phone: string }; vehicle: { year: number | null; make: string | null; model: string | null } | null; messages: { content: string }[] }[];
  recentCustomers: { id: string; name: string | null; phone: string; createdAt: string }[];
  lowStock: { id: string; sku: string; name: string; quantityInStock: number; minimumStockLevel: number }[];
  humanConversations: { id: string; humanReason: string | null; customer: { name: string | null; phone: string } }[];
}

function Stat({ label, value, icon, tone, href }: { label: string; value: ReactNode; icon: ReactNode; tone: string; href?: string }) {
  const body = (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function DashboardPage() {
  const { data, error, loading, reload } = useApi<Stats>("/api/dashboard/stats");
  if (loading && !data) return <Spinner />;
  if (!data) return <ErrorBanner message={error} onRetry={reload} />;
  const s = data.stats;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="What needs your attention today" />
      <ErrorBanner message={error} onRetry={reload} />

      {(s.humanRequired > 0 || s.sendFailed > 0) && (
        <div className="mb-6 space-y-2">
          {s.humanRequired > 0 && (
            <Link href="/conversations?status=HUMAN_REQUIRED" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 hover:bg-red-100">
              <AlertTriangle className="h-5 w-5" />
              <span><strong>{s.humanRequired}</strong> customer{s.humanRequired === 1 ? " is" : "s are"} waiting for a person. The AI has stopped replying in {s.humanRequired === 1 ? "that conversation" : "those conversations"}.</span>
            </Link>
          )}
          {s.sendFailed > 0 && (
            <Link href="/quotations?status=APPROVED" className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
              <AlertTriangle className="h-5 w-5" />
              <span><strong>{s.sendFailed}</strong> approved quotation{s.sendFailed === 1 ? "" : "s"} could not be delivered on WhatsApp. Open {s.sendFailed === 1 ? "it" : "them"} to retry.</span>
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Quotes today" value={s.quotesToday} icon={<FileText className="h-5 w-5" />} tone="bg-sky-100 text-sky-700" href="/quotations" />
        <Stat label="Pending approval" value={s.pendingApproval} icon={<Clock className="h-5 w-5" />} tone="bg-amber-100 text-amber-700" href="/quotations?status=PENDING_APPROVAL" />
        <Stat label="Sent" value={s.sent} icon={<Send className="h-5 w-5" />} tone="bg-indigo-100 text-indigo-700" href="/quotations?status=SENT" />
        <Stat label="Accepted" value={s.accepted} icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-100 text-emerald-700" href="/quotations?status=ACCEPTED" />
        <Stat label="Total quoted" value={money(s.totalQuotedValue)} icon={<TrendingUp className="h-5 w-5" />} tone="bg-brand-100 text-brand-700" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" padded={false} title="Quotations waiting for you" actions={<Link href="/quotations?status=PENDING_APPROVAL" className="text-xs font-semibold text-brand-700 hover:underline">View all</Link>}>
          {data.pendingQuotes.length === 0 ? (
            <EmptyState title="Nothing to approve" hint="New quotations prepared by the AI assistant will appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.pendingQuotes.map((q) => (
                <li key={q.id}>
                  <Link href={`/quotations/${q.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{q.quoteNumber} <span className="font-normal text-slate-500">- {q.customer.name || phoneLabel(q.customer.phone)}</span></p>
                      <p className="truncate text-xs text-slate-500">{vehicleLabel(q.vehicle)} - {timeAgo(q.createdAt)}</p>
                      {q.sendError && <p className="mt-0.5 truncate text-xs text-red-600">Delivery failed: {q.sendError}</p>}
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-slate-800">{money(q.total)}</span>
                    <StatusBadge map={QUOTE_STATUS} status={q.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padded={false} title="Low stock" actions={<Link href="/inventory?stock=low" className="text-xs font-semibold text-brand-700 hover:underline">Inventory</Link>}>
          {data.lowStock.length === 0 ? (
            <EmptyState title="Stock levels look healthy" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.lowStock.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <PackageX className="h-4 w-4 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-500">{p.sku}</p>
                  </div>
                  <Badge tone={p.quantityInStock === 0 ? "red" : "amber"}>{p.quantityInStock} left</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2" padded={false} title="Recent conversations" actions={<Link href="/conversations" className="text-xs font-semibold text-brand-700 hover:underline">Open inbox</Link>}>
          {data.recentConversations.length === 0 ? (
            <EmptyState title="No conversations yet" hint="Messages sent to your WhatsApp number will show up here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentConversations.map((c) => (
                <li key={c.id}>
                  <Link href={`/conversations?id=${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{c.customer.name || phoneLabel(c.customer.phone)} <span className="font-normal text-slate-500">- {vehicleLabel(c.vehicle)}</span></p>
                      <p className="truncate text-xs text-slate-500">{c.messages[0]?.content ?? "No messages"}</p>
                    </div>
                    {c.unreadCount > 0 && <Badge tone="orange">{c.unreadCount} new</Badge>}
                    <StatusBadge map={CONVERSATION_STATUS} status={c.status} />
                    <span className="hidden text-xs text-slate-400 sm:block">{timeAgo(c.lastMessageAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padded={false} title="Recent customers" actions={<Link href="/customers" className="text-xs font-semibold text-brand-700 hover:underline">All customers</Link>}>
          {data.recentCustomers.length === 0 ? (
            <EmptyState title="No customers yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentCustomers.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <UserRound className="h-4 w-4 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{c.name || "Unnamed customer"}</p>
                    <p className="text-xs text-slate-500">{phoneLabel(c.phone)}</p>
                  </div>
                  <span className="text-xs text-slate-400">{dateOnly(c.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="mt-6 text-xs text-slate-400">Open part requests: {num(s.openPartRequests)}. <Link href="/part-requests" className="text-brand-700 hover:underline">Review</Link></p>
    </>
  );
}
