"use client";

import { Copy, Download, Eye, Send, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBanner, Input, PageHeader, Pagination, SearchInput, Select, Spinner, StatusBadge, Table, Td, Th, errText, useToast } from "@/components/ui";
import { api, qs, useApi, useDebounced } from "@/lib/client";
import { QUOTE_STATUS, dateOnly, money, phoneLabel, vehicleLabel } from "@/lib/format";

interface Row {
  id: string;
  quoteNumber: string;
  status: string;
  total: string;
  source: string;
  createdAt: string;
  validUntil: string | null;
  sentAt: string | null;
  sendError: string | null;
  customer: { id: string; name: string | null; phone: string };
  vehicle: { year: number | null; make: string | null; model: string | null; variant: string | null; registrationNumber: string | null } | null;
  approvedBy: { name: string } | null;
}

function QuotationsInner() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const customerId = params.get("customerId") ?? undefined;
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const dc = useDebounced(customer);
  const dv = useDebounced(vehicle);
  const { data, error, loading, reload } = useApi<{ items: Row[]; total: number; pageSize: number }>(`/api/quotations${qs({ q: dq, status, customer: dc, vehicle: dv, dateFrom, dateTo, customerId, page })}`);
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    try {
      await fn();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusyId(null);
    }
  }

  const duplicate = (r: Row) => act(r.id, async () => {
    const res = await api<{ quotation: { id: string } }>(`/api/quotations/${r.id}/duplicate`, { method: "POST", body: {} });
    toast.success("Duplicated as a new draft");
    router.push(`/quotations/${res.quotation.id}`);
  });
  const resend = (r: Row) => act(r.id, async () => {
    const res = await api<{ sent: boolean; error?: string }>(`/api/quotations/${r.id}/send`, { method: "POST", body: {} });
    if (res.sent) toast.success(`${r.quoteNumber} sent on WhatsApp`);
    else toast.error(`Could not send: ${res.error}`);
    void reload();
  });

  return (
    <>
      <PageHeader title="Quotations" subtitle={customerId ? "Filtered to one customer" : "Review, edit and approve quotations before customers see them"} />
      <ErrorBanner message={error} onRetry={reload} />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Quote number, customer, vehicle" /></div>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Input placeholder="Customer" value={customer} onChange={(e) => { setCustomer(e.target.value); setPage(1); }} />
          <Input placeholder="Vehicle" value={vehicle} onChange={(e) => { setVehicle(e.target.value); setPage(1); }} />
          <div className="flex items-center gap-2">
            <Input type="date" className="min-w-0" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} aria-label="From date" />
            <Input type="date" className="min-w-0" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} aria-label="To date" />
          </div>
        </div>
        {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState title="No quotations found" hint="Quotations prepared by the AI assistant land here for approval." /> : (
          <>
            <Table>
              <thead><tr><Th>Quote</Th><Th>Customer</Th><Th>Vehicle</Th><Th align="right">Total</Th><Th>Status</Th><Th>Created</Th><Th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td><Link href={`/quotations/${r.id}`} className="font-semibold text-brand-700 hover:underline">{r.quoteNumber}</Link>{r.source === "AI" && <Badge tone="indigo" className="ml-2">AI</Badge>}</Td>
                    <Td><p className="font-medium text-slate-900">{r.customer.name || "Unnamed"}</p><p className="text-xs text-slate-500">{phoneLabel(r.customer.phone)}</p></Td>
                    <Td>{vehicleLabel(r.vehicle)}{r.vehicle?.registrationNumber && <p className="text-xs text-slate-500">{r.vehicle.registrationNumber}</p>}</Td>
                    <Td align="right" className="font-semibold">{money(r.total)}</Td>
                    <Td><StatusBadge map={QUOTE_STATUS} status={r.status} />{r.status === "APPROVED" && r.sendError && <p className="mt-1 max-w-[12rem] truncate text-xs text-red-600" title={r.sendError}>Delivery failed</p>}</Td>
                    <Td>{dateOnly(r.createdAt)}</Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/quotations/${r.id}`}><Button size="sm" variant="ghost" title="View / edit" aria-label={`View ${r.quoteNumber}`}><Eye className="h-4 w-4" /></Button></Link>
                        <Button size="sm" variant="ghost" title="Duplicate" aria-label={`Duplicate ${r.quoteNumber}`} loading={busyId === r.id} onClick={() => duplicate(r)}><Copy className="h-4 w-4" /></Button>
                        <a href={`/api/quotations/${r.id}/pdf`} title="Download PDF" aria-label={`Download PDF ${r.quoteNumber}`}><Button size="sm" variant="ghost"><Download className="h-4 w-4" /></Button></a>
                        {(r.status === "SENT" || (r.status === "APPROVED")) && <Button size="sm" variant="ghost" title={r.status === "SENT" ? "Resend on WhatsApp" : "Retry sending"} aria-label={`Resend ${r.quoteNumber}`} loading={busyId === r.id} onClick={() => resend(r)}><Send className="h-4 w-4" /></Button>}
                        {["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"].includes(r.status) && <Button size="sm" variant="ghost" title="Cancel quotation" aria-label={`Cancel ${r.quoteNumber}`} onClick={() => setCancelling(r)}><XCircle className="h-4 w-4 text-red-600" /></Button>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <ConfirmDialog open={!!cancelling} onClose={() => setCancelling(null)} danger confirmLabel="Cancel quotation" title="Cancel this quotation?" message={cancelling && `${cancelling.quoteNumber} will be marked as cancelled. The customer is not notified automatically.`} onConfirm={async () => { try { await api(`/api/quotations/${cancelling!.id}/cancel`, { body: {} }); toast.success("Quotation cancelled"); setCancelling(null); void reload(); } catch (e) { toast.error(errText(e)); } }} />
    </>
  );
}

export default function QuotationsPage() {
  return <Suspense fallback={<Spinner />}><QuotationsInner /></Suspense>;
}
