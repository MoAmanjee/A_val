"use client";

import { Pencil, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Td, Th, errText, useToast } from "@/components/ui";
import { api, qs, useApi, useDebounced } from "@/lib/client";
import { phoneLabel } from "@/lib/format";

interface Vehicle {
  id: string;
  customerId: string | null;
  vin: string | null;
  vinDecoded: boolean;
  registrationNumber: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  variant: string | null;
  engine: string | null;
  engineCode: string | null;
  engineSize: string | null;
  fuelType: string | null;
  transmission: string | null;
  mileage: number | null;
  customer: { id: string; name: string | null; phone: string } | null;
}

function VehiclesInner() {
  const toast = useToast();
  const params = useSearchParams();
  const customerId = params.get("customerId") ?? undefined;
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useApi<{ items: Vehicle[]; total: number; pageSize: number }>(`/api/vehicles${qs({ q: dq, page, customerId })}`);
  const customers = useApi<{ items: { id: string; name: string | null; phone: string }[] }>("/api/customers?pageSize=100");
  const [editing, setEditing] = useState<Partial<Vehicle> | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof Vehicle, v: string) => setEditing((e) => ({ ...e, [k]: v }));

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const text = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
      const body = {
        customerId: editing.customerId || null,
        vin: text(editing.vin),
        registrationNumber: text(editing.registrationNumber),
        make: text(editing.make), model: text(editing.model), variant: text(editing.variant),
        engine: text(editing.engine), engineCode: text(editing.engineCode), engineSize: text(editing.engineSize),
        fuelType: text(editing.fuelType), transmission: text(editing.transmission),
        year: editing.year ? Number(editing.year) : null,
        mileage: editing.mileage ? Number(editing.mileage) : null,
      };
      if (editing.id) await api(`/api/vehicles/${editing.id}`, { method: "PUT", body });
      else await api("/api/vehicles", { body });
      toast.success("Vehicle saved");
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
      <PageHeader title="Vehicles" subtitle={customerId ? "Filtered to one customer" : "Vehicles captured from conversations or added by staff"} actions={<Button onClick={() => setEditing({ customerId: customerId ?? null })}><Plus className="h-4 w-4" /> Add vehicle</Button>} />
      <ErrorBanner message={error} onRetry={reload} />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search make, model, VIN, reg or owner" /></div>
        {loading && !data ? <Spinner /> : !data?.items.length ? (
          <EmptyState title="No vehicles yet" hint="The assistant saves each customer's vehicle as it collects details." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Vehicle</Th><Th>Engine</Th><Th>VIN</Th><Th>Reg</Th><Th>Owner</Th><Th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">{[v.year, v.make, v.model, v.variant].filter(Boolean).join(" ") || "Unidentified"}</Td>
                    <Td>{[v.engine ?? v.engineSize, v.fuelType, v.transmission].filter(Boolean).join(" / ") || "-"}</Td>
                    <Td className="font-mono text-xs">{v.vin ?? "-"} {v.vinDecoded && <Badge tone="green">decoded</Badge>}</Td>
                    <Td>{v.registrationNumber ?? "-"}</Td>
                    <Td>{v.customer ? v.customer.name || phoneLabel(v.customer.phone) : "-"}</Td>
                    <Td align="right"><Button size="sm" variant="ghost" onClick={() => setEditing(v)} aria-label="Edit vehicle"><Pencil className="h-4 w-4" /></Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal size="lg" open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit vehicle" : "Add vehicle"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save vehicle</Button></>}>
        {editing && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Make"><Input value={editing.make ?? ""} onChange={(e) => set("make", e.target.value)} /></Field>
            <Field label="Model"><Input value={editing.model ?? ""} onChange={(e) => set("model", e.target.value)} /></Field>
            <Field label="Year"><Input type="number" value={editing.year ?? ""} onChange={(e) => set("year", e.target.value)} /></Field>
            <Field label="Variant"><Input value={editing.variant ?? ""} onChange={(e) => set("variant", e.target.value)} /></Field>
            <Field label="Engine"><Input value={editing.engine ?? ""} onChange={(e) => set("engine", e.target.value)} placeholder="1.4 TSI" /></Field>
            <Field label="Engine code"><Input value={editing.engineCode ?? ""} onChange={(e) => set("engineCode", e.target.value)} /></Field>
            <Field label="Fuel">
              <Select value={editing.fuelType ?? ""} onChange={(e) => set("fuelType", e.target.value)}><option value="">Unknown</option><option>Petrol</option><option>Diesel</option><option>Hybrid</option><option>Electric</option></Select>
            </Field>
            <Field label="Transmission">
              <Select value={editing.transmission ?? ""} onChange={(e) => set("transmission", e.target.value)}><option value="">Unknown</option><option>Manual</option><option>Automatic</option></Select>
            </Field>
            <Field label="Mileage (km)"><Input type="number" value={editing.mileage ?? ""} onChange={(e) => set("mileage", e.target.value)} /></Field>
            <Field label="VIN" hint="17 characters. Validated on save." className="sm:col-span-2"><Input value={editing.vin ?? ""} onChange={(e) => set("vin", e.target.value.toUpperCase())} className="font-mono" maxLength={17} /></Field>
            <Field label="Registration"><Input value={editing.registrationNumber ?? ""} onChange={(e) => set("registrationNumber", e.target.value)} /></Field>
            <Field label="Owner" className="sm:col-span-3">
              <Select value={editing.customerId ?? ""} onChange={(e) => set("customerId", e.target.value)}>
                <option value="">No owner</option>
                {customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name || phoneLabel(c.phone)} ({phoneLabel(c.phone)})</option>)}
              </Select>
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function VehiclesPage() {
  return <Suspense fallback={<Spinner />}><VehiclesInner /></Suspense>;
}
