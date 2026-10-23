"use client";

import { Download, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { ImportWizard } from "@/components/import-wizard";
import { Button, Card, ConfirmDialog, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Td, Th, errText, useToast } from "@/components/ui";
import { api, qs, useApi, useDebounced } from "@/lib/client";

interface Row {
  id: string;
  make: string;
  model: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  variant: string | null;
  engine: string | null;
  engineCode: string | null;
  fuelType: string | null;
  transmission: string | null;
  notes: string | null;
  part: { id: string; sku: string; partNumber: string | null; name: string };
}

export default function FitmentPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useApi<{ items: Row[]; total: number; pageSize: number }>(`/api/fitment${qs({ q: dq, page, pageSize: 50 })}`);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [del, setDel] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [partQ, setPartQ] = useState("");
  const dpq = useDebounced(partQ);
  const parts = useApi<{ items: { id: string; sku: string; name: string; partNumber: string | null }[] }>(adding && dpq.length > 1 ? `/api/parts${qs({ q: dpq, pageSize: 10 })}` : null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function add() {
    setBusy(true);
    try {
      const t = (k: string) => form[k]?.trim() || null;
      await api("/api/fitment", { body: { partId: form.partId, make: form.make, model: t("model"), variant: t("variant"), engine: t("engine"), engineCode: t("engineCode"), fuelType: t("fuelType"), transmission: t("transmission"), notes: t("notes"), yearFrom: form.yearFrom ? Number(form.yearFrom) : null, yearTo: form.yearTo ? Number(form.yearTo) : null } });
      toast.success("Fitment added");
      setAdding(false);
      setForm({});
      setPartQ("");
      void reload();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Fitment database"
        subtitle="Which parts fit which vehicles. The assistant never recommends a part that conflicts with this data."
        actions={<><a href="/api/fitment/export"><Button variant="secondary"><Download className="h-4 w-4" /> Export</Button></a><Button variant="secondary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> Import</Button><Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add fitment</Button></>}
      />
      <ErrorBanner message={error} onRetry={reload} />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search make, model, part number, SKU" /></div>
        {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState title="No fitment rows" hint="Import a fitment spreadsheet or add rows from a part's fitment dialog in Inventory." /> : (
          <>
            <Table>
              <thead><tr><Th>Part</Th><Th>Make</Th><Th>Model</Th><Th>Years</Th><Th>Variant</Th><Th>Engine</Th><Th>Fuel</Th><Th>Trans.</Th><Th>Notes</Th><Th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td><p className="font-medium text-slate-900">{r.part.name}</p><p className="font-mono text-xs text-slate-500">{r.part.sku}{r.part.partNumber ? ` / ${r.part.partNumber}` : ""}</p></Td>
                    <Td>{r.make}</Td><Td>{r.model ?? "Any"}</Td><Td>{r.yearFrom ?? "..."} - {r.yearTo ?? "..."}</Td><Td>{r.variant ?? "Any"}</Td><Td>{[r.engine, r.engineCode].filter(Boolean).join(" ") || "Any"}</Td><Td>{r.fuelType ?? "Any"}</Td><Td>{r.transmission ?? "Any"}</Td><Td className="max-w-[12rem] truncate">{r.notes}</Td>
                    <Td align="right"><Button size="sm" variant="ghost" aria-label="Delete fitment" onClick={() => setDel(r)}><Trash2 className="h-4 w-4 text-red-600" /></Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal size="lg" open={adding} onClose={() => setAdding(false)} title="Add fitment" footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button loading={busy} disabled={!form.partId || !form.make?.trim()} onClick={add}>Add fitment</Button></>}>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Find part *" className="sm:col-span-4">
            <Input value={partQ} onChange={(e) => { setPartQ(e.target.value); set("partId", ""); }} placeholder="Type SKU, part number or name" />
            {parts.data && !form.partId && (
              <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm shadow">
                {parts.data.items.length === 0 && <li className="px-3 py-2 text-slate-500">No parts found</li>}
                {parts.data.items.map((p) => <li key={p.id}><button className="w-full px-3 py-2 text-left hover:bg-brand-50" onClick={() => { set("partId", p.id); setPartQ(`${p.sku} - ${p.name}`); }}>{p.sku} - {p.name}</button></li>)}
              </ul>
            )}
          </Field>
          <Field label="Make *"><Input value={form.make ?? ""} onChange={(e) => set("make", e.target.value)} /></Field>
          <Field label="Model"><Input value={form.model ?? ""} onChange={(e) => set("model", e.target.value)} /></Field>
          <Field label="Year from"><Input type="number" value={form.yearFrom ?? ""} onChange={(e) => set("yearFrom", e.target.value)} /></Field>
          <Field label="Year to"><Input type="number" value={form.yearTo ?? ""} onChange={(e) => set("yearTo", e.target.value)} /></Field>
          <Field label="Variant"><Input value={form.variant ?? ""} onChange={(e) => set("variant", e.target.value)} /></Field>
          <Field label="Engine"><Input value={form.engine ?? ""} onChange={(e) => set("engine", e.target.value)} /></Field>
          <Field label="Fuel"><Select value={form.fuelType ?? ""} onChange={(e) => set("fuelType", e.target.value)}><option value="">Any</option><option>Petrol</option><option>Diesel</option><option>Hybrid</option></Select></Field>
          <Field label="Transmission"><Select value={form.transmission ?? ""} onChange={(e) => set("transmission", e.target.value)}><option value="">Any</option><option>Manual</option><option>Automatic</option></Select></Field>
          <Field label="Notes" className="sm:col-span-4"><Input value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>
      </Modal>

      <ImportWizard open={importing} onClose={() => setImporting(false)} endpoint="/api/fitment/import" title="Import fitment" onDone={reload} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger confirmLabel="Delete" title="Delete fitment row?" message={del && `${del.part.name} will no longer be matched to ${del.make} ${del.model ?? ""}.`} onConfirm={async () => { try { await api(`/api/fitment/${del!.id}`, { method: "DELETE" }); toast.success("Fitment deleted"); setDel(null); void reload(); } catch (e) { toast.error(errText(e)); } }} />
    </>
  );
}
