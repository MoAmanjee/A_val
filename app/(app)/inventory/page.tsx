"use client";

import { ArrowDownUp, Download, Link2, Pencil, Plus, Power, Trash2, Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ImportWizard } from "@/components/import-wizard";
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Td, Textarea, Th, errText, useToast } from "@/components/ui";
import { api, qs, useApi, useDebounced } from "@/lib/client";
import { money, num } from "@/lib/format";

interface Part {
  id: string;
  sku: string;
  partNumber: string | null;
  barcode: string | null;
  name: string;
  description: string | null;
  category: string | null;
  manufacturer: string | null;
  costPrice: string;
  sellingPrice: string;
  vatRate: string | null;
  quantityInStock: number;
  minimumStockLevel: number;
  location: string | null;
  active: boolean;
  universal: boolean;
  recommended: boolean;
  _count?: { fitments: number };
}
interface Fitment { id: string; make: string; model: string | null; yearFrom: number | null; yearTo: number | null; variant: string | null; engine: string | null; engineCode: string | null; fuelType: string | null; transmission: string | null; notes: string | null }

const blank: Partial<Part> = { active: true, universal: false, recommended: false, quantityInStock: 0, minimumStockLevel: 0 };

function StockBadge({ p }: { p: Part }) {
  if (p.quantityInStock <= 0) return <Badge tone="red">Out of stock</Badge>;
  if (p.minimumStockLevel > 0 && p.quantityInStock <= p.minimumStockLevel) return <Badge tone="amber">{p.quantityInStock} - low</Badge>;
  return <Badge tone="green">{p.quantityInStock}</Badge>;
}

function FitmentModal({ part, onClose, onChanged }: { part: Part | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<{ items: Fitment[] }>(part ? `/api/fitment?partId=${part.id}&pageSize=200` : null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function add() {
    if (!part) return;
    setBusy(true);
    try {
      const t = (k: string) => form[k]?.trim() || null;
      await api("/api/fitment", { body: { partId: part.id, make: form.make, model: t("model"), variant: t("variant"), engine: t("engine"), engineCode: t("engineCode"), fuelType: t("fuelType"), transmission: t("transmission"), notes: t("notes"), yearFrom: form.yearFrom ? Number(form.yearFrom) : null, yearTo: form.yearTo ? Number(form.yearTo) : null } });
      setForm({});
      await reload();
      onChanged();
      toast.success("Fitment added");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    try {
      await api(`/api/fitment/${id}`, { method: "DELETE" });
      await reload();
      onChanged();
    } catch (e) {
      toast.error(errText(e));
    }
  }

  return (
    <Modal open={!!part} onClose={onClose} size="xl" title={part ? `Fitment - ${part.name} (${part.sku})` : "Fitment"} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {part?.universal && <p className="mb-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-800">This part is flagged universal, so it is offered for any vehicle. Fitment rows below are optional.</p>}
      <div className="rounded-lg border border-slate-200">
        <Table>
          <thead><tr><Th>Make</Th><Th>Model</Th><Th>Years</Th><Th>Variant</Th><Th>Engine</Th><Th>Fuel</Th><Th>Trans.</Th><Th>Notes</Th><Th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data?.items.length ? data.items.map((f) => (
              <tr key={f.id}>
                <Td>{f.make}</Td><Td>{f.model ?? "Any"}</Td><Td>{f.yearFrom ?? "..."} - {f.yearTo ?? "..."}</Td><Td>{f.variant ?? "Any"}</Td><Td>{[f.engine, f.engineCode].filter(Boolean).join(" ") || "Any"}</Td><Td>{f.fuelType ?? "Any"}</Td><Td>{f.transmission ?? "Any"}</Td><Td className="max-w-[10rem] truncate">{f.notes}</Td>
                <Td align="right"><Button size="sm" variant="ghost" onClick={() => remove(f.id)} aria-label="Remove fitment"><Trash2 className="h-4 w-4 text-red-600" /></Button></Td>
              </tr>
            )) : <tr><Td colSpan={9} className="py-6 text-center text-slate-500">No fitment rows yet. Without fitment data this part is only shown with a &quot;verify compatibility&quot; warning.</Td></tr>}
          </tbody>
        </Table>
      </div>
      <p className="mb-2 mt-5 text-sm font-semibold text-slate-800">Add a compatible vehicle</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Make *"><Input value={form.make ?? ""} onChange={(e) => set("make", e.target.value)} /></Field>
        <Field label="Model"><Input value={form.model ?? ""} onChange={(e) => set("model", e.target.value)} /></Field>
        <Field label="Year from"><Input type="number" value={form.yearFrom ?? ""} onChange={(e) => set("yearFrom", e.target.value)} /></Field>
        <Field label="Year to"><Input type="number" value={form.yearTo ?? ""} onChange={(e) => set("yearTo", e.target.value)} /></Field>
        <Field label="Variant"><Input value={form.variant ?? ""} onChange={(e) => set("variant", e.target.value)} /></Field>
        <Field label="Engine"><Input value={form.engine ?? ""} onChange={(e) => set("engine", e.target.value)} /></Field>
        <Field label="Fuel"><Select value={form.fuelType ?? ""} onChange={(e) => set("fuelType", e.target.value)}><option value="">Any</option><option>Petrol</option><option>Diesel</option><option>Hybrid</option></Select></Field>
        <Field label="Transmission"><Select value={form.transmission ?? ""} onChange={(e) => set("transmission", e.target.value)}><option value="">Any</option><option>Manual</option><option>Automatic</option></Select></Field>
        <Field label="Notes" className="sm:col-span-3"><Input value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
        <div className="flex items-end"><Button className="w-full" disabled={!form.make?.trim()} loading={busy} onClick={add}><Plus className="h-4 w-4" /> Add</Button></div>
      </div>
    </Modal>
  );
}

function InventoryInner() {
  const toast = useToast();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("active");
  const [stock, setStock] = useState(params.get("stock") ?? "all");
  const [sort, setSort] = useState("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useApi<{ items: Part[]; total: number; pageSize: number }>(`/api/parts${qs({ q: dq, category, status, stock, sort, dir, page })}`);
  const cats = useApi<{ categories: string[] }>("/api/parts/categories");

  const [editing, setEditing] = useState<Partial<Part> | null>(null);
  const [adjusting, setAdjusting] = useState<Part | null>(null);
  const [adjust, setAdjust] = useState({ mode: "delta", value: "", reason: "" });
  const [fitmentFor, setFitmentFor] = useState<Part | null>(null);
  const [importing, setImporting] = useState(false);
  const [toggle, setToggle] = useState<Part | null>(null);
  const [busy, setBusy] = useState(false);

  const setF = (k: keyof Part, v: unknown) => setEditing((e) => ({ ...e, [k]: v }));
  const sortBy = (s: string) => { if (sort === s) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(s); setDir("asc"); } };

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const t = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
      const body = {
        sku: editing.sku, name: editing.name, partNumber: t(editing.partNumber), barcode: t(editing.barcode), description: t(editing.description),
        category: t(editing.category), manufacturer: t(editing.manufacturer), location: t(editing.location),
        costPrice: num(editing.costPrice), sellingPrice: num(editing.sellingPrice),
        vatRate: editing.vatRate === null || editing.vatRate === undefined || editing.vatRate === "" ? null : num(editing.vatRate),
        quantityInStock: num(editing.quantityInStock), minimumStockLevel: num(editing.minimumStockLevel),
        active: editing.active ?? true, universal: !!editing.universal, recommended: !!editing.recommended,
      };
      if (editing.id) await api(`/api/parts/${editing.id}`, { method: "PUT", body });
      else await api("/api/parts", { body });
      toast.success("Part saved");
      setEditing(null);
      void reload();
      void cats.reload();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveAdjust() {
    if (!adjusting) return;
    setBusy(true);
    try {
      const n = Number(adjust.value);
      await api(`/api/parts/${adjusting.id}/stock`, { body: { ...(adjust.mode === "set" ? { set: n } : { delta: n }), reason: adjust.reason || undefined } });
      toast.success("Stock updated");
      setAdjusting(null);
      void reload();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doToggle() {
    if (!toggle) return;
    try {
      await api(`/api/parts/${toggle.id}`, { method: "PUT", body: { active: !toggle.active } });
      toast.success(toggle.active ? "Part deactivated" : "Part reactivated");
      setToggle(null);
      void reload();
    } catch (e) {
      toast.error(errText(e));
    }
  }

  const sortHead = (label: string, key: string, align?: "right") => (
    <Th align={align}><button className="inline-flex items-center gap-1 uppercase" onClick={() => sortBy(key)}>{label}<ArrowDownUp className={`h-3 w-3 ${sort === key ? "text-brand-600" : "text-slate-300"}`} /></button></Th>
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Your stock and prices are the source of truth for every quotation"
        actions={
          <>
            <a href="/api/parts/export"><Button variant="secondary"><Download className="h-4 w-4" /> Export</Button></a>
            <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> Import</Button>
            <Button onClick={() => setEditing({ ...blank })}><Plus className="h-4 w-4" /> Add part</Button>
          </>
        }
      />
      <ErrorBanner message={error} onRetry={reload} />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchInput className="w-64 shrink-0" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search SKU, part number, name, brand" />
          <Select className="w-44" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">All categories</option>
            {cats.data?.categories.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <Select className="w-40" value={stock} onChange={(e) => { setStock(e.target.value); setPage(1); }}>
            <option value="all">Any stock level</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option>
          </Select>
          <Select className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
          </Select>
        </div>
        {loading && !data ? <Spinner /> : !data?.items.length ? (
          <EmptyState title="No parts match" hint="Add parts manually or import your stock list from CSV/Excel." action={<Button variant="secondary" onClick={() => setImporting(true)}>Import stock list</Button>} />
        ) : (
          <>
            <Table>
              <thead><tr>{sortHead("SKU", "sku")}{sortHead("Part", "name")}<Th>Category</Th><Th align="right">Cost</Th>{sortHead("Price", "price", "right")}{sortHead("Stock", "stock")}<Th align="center">Fitments</Th><Th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((p) => (
                  <tr key={p.id} className={p.active ? "hover:bg-slate-50" : "bg-slate-50 opacity-60"}>
                    <Td className="font-mono text-xs">{p.sku}</Td>
                    <Td>
                      <p className="font-medium text-slate-900">{p.name} {p.recommended && <Badge tone="orange">Recommended</Badge>} {p.universal && <Badge tone="blue">Universal</Badge>} {!p.active && <Badge>Inactive</Badge>}</p>
                      <p className="text-xs text-slate-500">{[p.manufacturer, p.partNumber, p.location && `Bin ${p.location}`].filter(Boolean).join(" - ")}</p>
                    </Td>
                    <Td>{p.category ?? "-"}</Td>
                    <Td align="right" className="text-slate-500">{money(p.costPrice)}</Td>
                    <Td align="right" className="font-semibold">{money(p.sellingPrice)}</Td>
                    <Td><StockBadge p={p} /></Td>
                    <Td align="center">{p._count?.fitments ?? 0}</Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="Edit" aria-label={`Edit ${p.sku}`} onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" title="Adjust stock" aria-label={`Adjust stock ${p.sku}`} onClick={() => { setAdjusting(p); setAdjust({ mode: "delta", value: "", reason: "" }); }}><ArrowDownUp className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" title="Fitment" aria-label={`Fitment ${p.sku}`} onClick={() => setFitmentFor(p)}><Link2 className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" title={p.active ? "Deactivate" : "Reactivate"} aria-label={p.active ? `Deactivate ${p.sku}` : `Reactivate ${p.sku}`} onClick={() => setToggle(p)}><Power className={`h-4 w-4 ${p.active ? "text-slate-500" : "text-emerald-600"}`} /></Button>
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

      <Modal size="lg" open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit part" : "Add part"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} onClick={save} disabled={!editing?.sku || !editing?.name}>Save part</Button></>}>
        {editing && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="SKU *"><Input value={editing.sku ?? ""} onChange={(e) => setF("sku", e.target.value)} /></Field>
            <Field label="Part number"><Input value={editing.partNumber ?? ""} onChange={(e) => setF("partNumber", e.target.value)} /></Field>
            <Field label="Barcode"><Input value={editing.barcode ?? ""} onChange={(e) => setF("barcode", e.target.value)} /></Field>
            <Field label="Name *" className="sm:col-span-2"><Input value={editing.name ?? ""} onChange={(e) => setF("name", e.target.value)} /></Field>
            <Field label="Manufacturer / brand"><Input value={editing.manufacturer ?? ""} onChange={(e) => setF("manufacturer", e.target.value)} /></Field>
            <Field label="Category"><Input list="cat-list" value={editing.category ?? ""} onChange={(e) => setF("category", e.target.value)} /><datalist id="cat-list">{cats.data?.categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
            <Field label="Location / bin"><Input value={editing.location ?? ""} onChange={(e) => setF("location", e.target.value)} /></Field>
            <Field label="VAT % override" hint="Blank = business default"><Input type="number" value={editing.vatRate ?? ""} onChange={(e) => setF("vatRate", e.target.value)} /></Field>
            <Field label="Cost price"><Input type="number" min="0" step="0.01" value={editing.costPrice ?? ""} onChange={(e) => setF("costPrice", e.target.value)} /></Field>
            <Field label="Selling price"><Input type="number" min="0" step="0.01" value={editing.sellingPrice ?? ""} onChange={(e) => setF("sellingPrice", e.target.value)} /></Field>
            <Field label="Stock on hand"><Input type="number" min="0" value={editing.quantityInStock ?? 0} onChange={(e) => setF("quantityInStock", e.target.value)} /></Field>
            <Field label="Minimum stock"><Input type="number" min="0" value={editing.minimumStockLevel ?? 0} onChange={(e) => setF("minimumStockLevel", e.target.value)} /></Field>
            <Field label="Description" className="sm:col-span-3"><Textarea value={editing.description ?? ""} onChange={(e) => setF("description", e.target.value)} /></Field>
            <div className="space-y-2 sm:col-span-3">
              <Checkbox label="Universal part" hint="Fits any vehicle (oil, wipers, batteries...). Offered without fitment rows." checked={!!editing.universal} onChange={(v) => setF("universal", v)} />
              <Checkbox label="Recommended" hint="Only recommended parts are ever labelled as such to customers." checked={!!editing.recommended} onChange={(v) => setF("recommended", v)} />
              <Checkbox label="Active" checked={editing.active ?? true} onChange={(v) => setF("active", v)} />
            </div>
          </div>
        )}
      </Modal>

      <Modal size="sm" open={!!adjusting} onClose={() => setAdjusting(null)} title={adjusting ? `Adjust stock - ${adjusting.sku}` : ""} footer={<><Button variant="secondary" onClick={() => setAdjusting(null)}>Cancel</Button><Button loading={busy} disabled={adjust.value === ""} onClick={saveAdjust}>Update stock</Button></>}>
        {adjusting && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Currently <strong>{adjusting.quantityInStock}</strong> in stock.</p>
            <Field label="Adjustment"><Select value={adjust.mode} onChange={(e) => setAdjust({ ...adjust, mode: e.target.value })}><option value="delta">Add / remove units</option><option value="set">Set exact quantity</option></Select></Field>
            <Field label={adjust.mode === "set" ? "New quantity" : "Change (negative to remove)"}><Input type="number" value={adjust.value} onChange={(e) => setAdjust({ ...adjust, value: e.target.value })} /></Field>
            <Field label="Reason"><Input value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} placeholder="Stock take, delivery received..." /></Field>
          </div>
        )}
      </Modal>

      <FitmentModal part={fitmentFor} onClose={() => setFitmentFor(null)} onChanged={reload} />
      <ImportWizard open={importing} onClose={() => setImporting(false)} endpoint="/api/parts/import" title="Import inventory" allowUpdate onDone={() => { void reload(); void cats.reload(); }} />
      <ConfirmDialog open={!!toggle} onClose={() => setToggle(null)} title={toggle?.active ? "Deactivate part?" : "Reactivate part?"} confirmLabel={toggle?.active ? "Deactivate" : "Reactivate"} danger={toggle?.active} onConfirm={doToggle} message={toggle?.active ? "Inactive parts are hidden from customer searches and cannot be quoted. Existing quotations are not affected." : "The part will appear in searches and quotations again."} />
    </>
  );
}

export default function InventoryPage() {
  return <Suspense fallback={<Spinner />}><InventoryInner /></Suspense>;
}
