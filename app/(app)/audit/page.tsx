"use client";

import { useState } from "react";
import { Badge, Card, EmptyState, ErrorBanner, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from "@/components/ui";
import { qs, useApi, useDebounced } from "@/lib/client";
import { dateTime } from "@/lib/format";

interface Log { id: string; action: string; entityType: string; entityId: string | null; summary: string | null; actor: string; createdAt: string; user: { name: string; email: string } | null }

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);
  const da = useDebounced(action);
  const { data, error, loading, reload } = useApi<{ items: Log[]; total: number; pageSize: number }>(`/api/audit${qs({ action: da, entityType, page })}`);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who changed what, including everything the AI assistant did" />
      <ErrorBanner message={error} onRetry={reload} />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input className="max-w-xs" placeholder="Action prefix, e.g. quote." value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          <Select className="w-44" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
            <option value="">All records</option>
            {["Quotation", "Part", "Customer", "Vehicle", "Conversation", "Business", "User", "LabourRate", "PartRequest", "VehicleFitment"].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </div>
        {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState title="No activity found" /> : (
          <>
            <Table>
              <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Details</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap text-xs">{dateTime(l.createdAt)}</Td>
                    <Td><Badge tone={l.actor === "AI" ? "indigo" : l.actor === "SYSTEM" ? "slate" : "orange"}>{l.actor === "USER" ? l.user?.name ?? "User" : l.actor}</Badge></Td>
                    <Td className="font-mono text-xs">{l.action}</Td>
                    <Td>{l.summary ?? `${l.entityType} ${l.entityId ?? ""}`}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
