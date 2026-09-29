"use client";

import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Td, Th, errText, useToast } from "@/components/ui";
import { api, qs, useApi, useDebounced } from "@/lib/client";
import { dateOnly, phoneLabel } from "@/lib/format";

interface Customer {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  preferredContactMethod: string;
  createdAt: string;
  _count: { vehicles: number; quotations: number; conversations: number };
}

export default function CustomersPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useApi<{ items: Customer[]; total: number; pageSize: number }>(`/api/customers${qs({ q: dq, page })}`);
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const body = { name: editing.name || null, phone: editing.phone, email: editing.email || "", preferredContactMethod: editing.preferredContactMethod || "WHATSAPP" };
      if (editing.id) await api(`/api/customers/${editing.id}`, { method: "PUT", body });
      else await api("/api/customers", { body });
      toast.success("Customer saved");
      setEditing(null);
      void reload();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone who has contacted you, plus customers you add manually" actions={<Button onClick={() => setEditing({ preferredContactMethod: "WHATSAPP" })}><Plus className="h-4 w-4" /> Add customer</Button>} />
      <ErrorBanner message={error} onRetry={reload} />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name, phone or email" />
        </div>
        {loading && !data ? <Spinner /> : !data?.items.length ? (
          <EmptyState title="No customers found" hint="Customers are created automatically when someone messages your WhatsApp number." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Customer</Th><Th>Phone</Th><Th>Email</Th><Th align="center">Vehicles</Th><Th align="center">Quotes</Th><Th>Since</Th><Th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">{c.name || <span className="text-slate-400">Unnamed</span>}</Td>
                    <Td>{phoneLabel(c.phone)}</Td>
                    <Td>{c.email ?? "-"}</Td>
                    <Td align="center"><Link href={`/vehicles?customerId=${c.id}`} className="text-brand-700 hover:underline">{c._count.vehicles}</Link></Td>
                    <Td align="center"><Link href={`/quotations?customerId=${c.id}`} className="text-brand-700 hover:underline">{c._count.quotations}</Link></Td>
                    <Td>{dateOnly(c.createdAt)}</Td>
                    <Td align="right"><Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={`Edit ${c.name ?? c.phone}`}><Pencil className="h-4 w-4" /></Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit customer" : "Add customer"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save customer</Button></>}>
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Phone (WhatsApp)" hint="Include country code, e.g. 27821234567"><Input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            <Field label="Preferred contact">
              <Select value={editing.preferredContactMethod ?? "WHATSAPP"} onChange={(e) => setEditing({ ...editing, preferredContactMethod: e.target.value })}>
                <option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option><option value="PHONE">Phone call</option>
              </Select>
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
