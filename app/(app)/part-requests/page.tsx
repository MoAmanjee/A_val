"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Select, Spinner, Table, Td, Th, errText, useToast } from "@/components/ui";
import { api, qs, useApi } from "@/lib/client";
import { phoneLabel, timeAgo, vehicleLabel } from "@/lib/format";

interface Req {
  id: string;
  description: string;
  notes: string | null;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "DISMISSED";
  createdAt: string;
  conversationId: string | null;
  customer: { name: string | null; phone: string } | null;
  vehicle: { year: number | null; make: string | null; model: string | null; variant: string | null } | null;
}
const TONE = { OPEN: "red", IN_PROGRESS: "amber", RESOLVED: "green", DISMISSED: "slate" } as const;

export default function PartRequestsPage() {
  const toast = useToast();
  const [status, setStatus] = useState("ACTIVE");
  const { data, error, loading, reload } = useApi<{ items: Req[] }>(`/api/part-requests${qs({ status: status === "ALL" ? "" : status })}`);

  async function setS(id: string, s: string) {
    try {
      await api(`/api/part-requests/${id}`, { method: "PUT", body: { status: s } });
      void reload();
    } catch (e) {
      toast.error(errText(e));
    }
  }

  return (
    <>
      <PageHeader title="Part requests" subtitle="Leads for parts customers asked for that were not in stock or not found" actions={<Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="ACTIVE">Needs action</option><option value="ALL">All</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option></Select>} />
      <ErrorBanner message={error} onRetry={reload} />
      <Card padded={false}>
        {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState title="No part requests" hint="When the assistant cannot find an in-stock part it logs a request here so nothing is lost." /> : (
          <Table>
            <thead><tr><Th>Requested</Th><Th>Customer</Th><Th>Vehicle</Th><Th>Status</Th><Th>Logged</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((r) => (
                <tr key={r.id}>
                  <Td><p className="font-medium text-slate-900">{r.description}</p>{r.notes && <p className="max-w-md text-xs text-slate-500">{r.notes}</p>}</Td>
                  <Td>{r.customer ? <><p>{r.customer.name || "Unnamed"}</p><p className="text-xs text-slate-500">{phoneLabel(r.customer.phone)}</p></> : "-"}</Td>
                  <Td>{vehicleLabel(r.vehicle)}</Td>
                  <Td><Badge tone={TONE[r.status]}>{r.status.replace("_", " ").toLowerCase()}</Badge></Td>
                  <Td>{timeAgo(r.createdAt)}</Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      {r.conversationId && <Link href={`/conversations?id=${r.conversationId}`}><Button size="sm" variant="ghost">Chat</Button></Link>}
                      {r.status === "OPEN" && <Button size="sm" variant="secondary" onClick={() => setS(r.id, "IN_PROGRESS")}>Start</Button>}
                      {(r.status === "OPEN" || r.status === "IN_PROGRESS") && <><Button size="sm" onClick={() => setS(r.id, "RESOLVED")}>Resolve</Button><Button size="sm" variant="ghost" onClick={() => setS(r.id, "DISMISSED")}>Dismiss</Button></>}
                      {(r.status === "RESOLVED" || r.status === "DISMISSED") && <Button size="sm" variant="ghost" onClick={() => setS(r.id, "OPEN")}>Reopen</Button>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
