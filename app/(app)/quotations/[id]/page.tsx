"use client";

import { AlertTriangle, ArrowLeft, Copy, Download, ExternalLink, MessageSquare, Plus, Save, Send, Trash2, XCircle, CheckCircle2, ThumbsDown, ThumbsUp, Repeat } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBanner, Field, Input, Modal, Select, Spinner, StatusBadge, Table, Td, Textarea, Th, errText, useToast } from "@/components/ui";
import { api, qs, useApi, useDebounced } from "@/lib/client";
import { QUOTE_STATUS, dateTime, money, num, phoneLabel, timeAgo, vehicleLabel } from "@/lib/format";
import { calculateQuote } from "@/services/quotes/calc";

interface Alt { partId: string; name: string; partNumber: string | null; sku: string | null; manufacturer: string | null; sellingPrice: number | string; stock: number; confidence: string }
interface ServerItem { id: string; partId: string | null; description: string; sku: string | null; partNumber: string | null; quantity: string; unitPrice: string; discount: string; vatRate: string; total: string; fitmentConfidence: string | null; matchNote: string | null; alternatives: Alt[] | null }
interface ServerLabour { id: string; labourId: string | null; description: string; hours: string; unitPrice: string; vatRate: string; total: string }
interface Quote {
  id: string; quoteNumber: string; status: string; source: string; subtotal: string; labourTotal: string; discount: string; vat: string; total: string; vatRate: string; pricesIncludeVat: boolean;
  validUntil: string | null; notes: string | null; internalNotes: string | null; sentAt: string | null; approvedAt: string | null; sendError: string | null; lastSendAttemptAt: string | null; whatsappMessageId: string | null; conversationId: string | null;
  customer: { id: string; name: string | null; phone: string; email: string | null };
  vehicle: { id: string; year: number | null; make: string | null; model: string | null; variant: string | null; engine: string | null; vin: string | null; registrationNumber: string | null } | null;
  items: ServerItem[]; labour: ServerLabour[];
  createdBy: { name: string } | null; approvedBy: { name: string } | null;
}
interface EItem { key: string; id?: string; partId: string | null; description: string; sku: string | null; partNumber: string | null; quantity: string; unitPrice: string; discount: string; vatRate: string; fitmentConfidence: string | null; matchNote: string | null; alternatives: Alt[] | null }
interface ELabour { key: string; id?: string; labourId: string | null; description: string; hours: string; unitPrice: string; vatRate: string }

const toItems = (q: Quote): EItem[] => q.items.map((i) => ({ key: i.id, id: i.id, partId: i.partId, description: i.description, sku: i.sku, partNumber: i.partNumber, quantity: String(num(i.quantity)), unitPrice: String(num(i.unitPrice)), discount: String(num(i.discount)), vatRate: String(num(i.vatRate)), fitmentConfidence: i.fitmentConfidence, matchNote: i.matchNote, alternatives: i.alternatives }));
const toLabour = (q: Quote): ELabour[] => q.labour.map((l) => ({ key: l.id, id: l.id, labourId: l.labourId, description: l.description, hours: String(num(l.hours)), unitPrice: String(num(l.unitPrice)), vatRate: String(num(l.vatRate)) }));
const isoDate = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
let keySeq = 0;
const newKey = () => `n${++keySeq}`;

const CONF_TONE: Record<string, string> = { EXACT: "green", HIGH: "green", MEDIUM: "amber", LOW: "amber", UNIVERSAL: "blue", UNVERIFIED: "slate" };

function AddPartModal({ open, onClose, vehicleId, onAdd }: { open: boolean; onClose: () => void; vehicleId: string | null; onAdd: (i: EItem) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, loading } = useApi<{ matches: { part: { id: string; sku: string; partNumber: string | null; name: string; manufacturer: string | null; sellingPrice: number; vatRate: number | null; quantityInStock: number }; fit: { status: string; confidence: string; notes?: string }; availability: string; notes: string[] }[] }>(open ? `/api/parts/search${qs({ q: dq, vehicleId })}` : null);
  const [custom, setCustom] = useState({ description: "", quantity: "1", unitPrice: "" });

  return (
    <Modal size="lg" open={open} onClose={onClose} title="Add part" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <Input autoFocus placeholder="Search inventory by name, SKU or part number" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200">
        {loading && !data ? <Spinner /> : !data?.matches.length ? <p className="p-6 text-center text-sm text-slate-500">{dq ? "No matching parts in stock records." : "Type to search your inventory."}</p> : (
          <ul className="divide-y divide-slate-100">
            {data.matches.map((m) => (
              <li key={m.part.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{m.part.name}</p>
                  <p className="text-xs text-slate-500">{[m.part.manufacturer, m.part.partNumber, m.part.sku].filter(Boolean).join(" - ")}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {vehicleId && <Badge tone={m.fit.status === "CONFLICT" ? "red" : CONF_TONE[m.fit.confidence] ?? "slate"}>{m.fit.status === "CONFLICT" ? "Does not fit" : m.fit.status === "NO_DATA" ? "No fitment data" : `Fit: ${m.fit.confidence.toLowerCase()}`}</Badge>}
                    <Badge tone={m.availability === "OUT_OF_STOCK" ? "red" : m.availability === "LOW_STOCK" ? "amber" : "green"}>{m.part.quantityInStock} in stock</Badge>
                  </div>
                </div>
                <span className="text-sm font-semibold tabular-nums">{money(m.part.sellingPrice)}</span>
                <Button size="sm" onClick={() => { onAdd({ key: newKey(), partId: m.part.id, description: m.part.name, sku: m.part.sku, partNumber: m.part.partNumber, quantity: "1", unitPrice: String(m.part.sellingPrice), discount: "0", vatRate: String(m.part.vatRate ?? ""), fitmentConfidence: m.fit.confidence, matchNote: m.notes.join("; ") || null, alternatives: null }); onClose(); }}>Add</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mb-2 mt-5 text-sm font-semibold text-slate-800">Or add a custom item</p>
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Description" className="sm:col-span-3"><Input value={custom.description} onChange={(e) => setCustom({ ...custom, description: e.target.value })} /></Field>
        <Field label="Qty"><Input type="number" min="1" value={custom.quantity} onChange={(e) => setCustom({ ...custom, quantity: e.target.value })} /></Field>
        <Field label="Unit price"><Input type="number" min="0" step="0.01" value={custom.unitPrice} onChange={(e) => setCustom({ ...custom, unitPrice: e.target.value })} /></Field>
        <div className="flex items-end"><Button className="w-full" disabled={!custom.description.trim() || custom.unitPrice === ""} onClick={() => { onAdd({ key: newKey(), partId: null, description: custom.description.trim(), sku: null, partNumber: null, quantity: custom.quantity || "1", unitPrice: custom.unitPrice, discount: "0", vatRate: "", fitmentConfidence: null, matchNote: "Custom item", alternatives: null }); setCustom({ description: "", quantity: "1", unitPrice: "" }); onClose(); }}>Add</Button></div>
      </div>
    </Modal>
  );
}

function AddLabourModal({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (l: ELabour) => void }) {
  const { data } = useApi<{ items: { id: string; name: string; description: string | null; hourlyRate: string | null; fixedPrice: string | null; defaultHours: string }[] }>(open ? "/api/labour" : null);
  const [custom, setCustom] = useState({ description: "", hours: "1", unitPrice: "" });
  return (
    <Modal size="lg" open={open} onClose={onClose} title="Add labour" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
        <ul className="divide-y divide-slate-100">
          {data?.items.map((r) => {
            const fixed = num(r.fixedPrice) > 0 && !num(r.hourlyRate);
            const hours = fixed ? 1 : num(r.defaultHours);
            const price = fixed ? num(r.fixedPrice) : num(r.hourlyRate);
            return (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex-1"><p className="text-sm font-medium text-slate-900">{r.name}</p><p className="text-xs text-slate-500">{fixed ? `${money(price)} fixed` : `${money(price)}/hour x ${hours}h`}</p></div>
                <Button size="sm" onClick={() => { onAdd({ key: newKey(), labourId: r.id, description: r.name, hours: String(hours), unitPrice: String(price), vatRate: "" }); onClose(); }}>Add</Button>
              </li>
            );
          })}
          {data && !data.items.length && <li className="p-6 text-center text-sm text-slate-500">No labour rates configured yet.</li>}
        </ul>
      </div>
      <p className="mb-2 mt-5 text-sm font-semibold text-slate-800">Or add custom labour</p>
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Description" className="sm:col-span-3"><Input value={custom.description} onChange={(e) => setCustom({ ...custom, description: e.target.value })} /></Field>
        <Field label="Hours"><Input type="number" min="0.25" step="0.25" value={custom.hours} onChange={(e) => setCustom({ ...custom, hours: e.target.value })} /></Field>
        <Field label="Rate / hour"><Input type="number" min="0" step="0.01" value={custom.unitPrice} onChange={(e) => setCustom({ ...custom, unitPrice: e.target.value })} /></Field>
        <div className="flex items-end"><Button className="w-full" disabled={!custom.description.trim() || custom.unitPrice === ""} onClick={() => { onAdd({ key: newKey(), labourId: null, description: custom.description.trim(), hours: custom.hours || "1", unitPrice: custom.unitPrice, vatRate: "" }); setCustom({ description: "", hours: "1", unitPrice: "" }); onClose(); }}>Add</Button></div>
      </div>
    </Modal>
  );
}

export default function QuoteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<{ quotation: Quote }>(`/api/quotations/${id}`);
  const audit = useApi<{ items: { id: string; action: string; summary: string | null; actor: string; createdAt: string; user: { name: string } | null }[] }>(`/api/audit${qs({ entityType: "Quotation", entityId: id, pageSize: 50 })}`);
  const { data: settings } = useApi<{ business: { currencySymbol: string } }>("/api/settings");
  const sym = settings?.business.currencySymbol ?? "R";

  const [items, setItems] = useState<EItem[]>([]);
  const [labour, setLabour] = useState<ELabour[]>([]);
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [addPart, setAddPart] = useState(false);
  const [addLabour, setAddLabour] = useState(false);
  const [confirm, setConfirm] = useState<null | "cancel" | "approve">(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const q = data?.quotation;
  const hydrate = useCallback((quote: Quote) => {
    setItems(toItems(quote));
    setLabour(toLabour(quote));
    setNotes(quote.notes ?? "");
    setInternalNotes(quote.internalNotes ?? "");
    setValidUntil(isoDate(quote.validUntil));
    setDirty(false);
  }, []);
  useEffect(() => {
    if (q) hydrate(q);
    // hydrate only when a different server version arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.id, q?.status, (q as Quote | undefined)?.total, (q as Quote | undefined)?.sendError, (q as Quote | undefined)?.sentAt]);

  const editable = q?.status === "DRAFT" || q?.status === "PENDING_APPROVAL";
  const vatDefault = num(q?.vatRate);

  const calc = useMemo(() => {
    if (!q) return null;
    try {
      const r = calculateQuote({
        items: items.map((i) => ({ quantity: num(i.quantity), unitPrice: num(i.unitPrice), discount: num(i.discount), vatRate: i.vatRate === "" ? vatDefault : num(i.vatRate) })),
        labour: labour.map((l) => ({ hours: num(l.hours), unitPrice: num(l.unitPrice), discount: 0, vatRate: l.vatRate === "" ? vatDefault : num(l.vatRate) })),
        pricesIncludeVat: q.pricesIncludeVat,
      });
      return { ok: true as const, ...r };
    } catch (e) {
      return { ok: false as const, message: errText(e) };
    }
  }, [items, labour, q, vatDefault]);

  const patchItem = (key: string, p: Partial<EItem>) => { setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i))); setDirty(true); };
  const patchLabour = (key: string, p: Partial<ELabour>) => { setLabour((cur) => cur.map((l) => (l.key === key ? { ...l, ...p } : l))); setDirty(true); };

  function payload() {
    return {
      items: items.map((i) => ({ id: i.id, partId: i.partId, description: i.description, sku: i.sku, partNumber: i.partNumber, quantity: num(i.quantity), unitPrice: num(i.unitPrice), discount: num(i.discount), ...(i.vatRate !== "" ? { vatRate: num(i.vatRate) } : {}), fitmentConfidence: i.fitmentConfidence, matchNote: i.matchNote })),
      labour: labour.map((l) => ({ id: l.id, labourId: l.labourId, description: l.description, hours: num(l.hours), unitPrice: num(l.unitPrice), ...(l.vatRate !== "" ? { vatRate: num(l.vatRate) } : {}) })),
      notes: notes || null,
      internalNotes: internalNotes || null,
      validUntil: validUntil || null,
    };
  }

  async function save(silent = false): Promise<Quote | null> {
    setBusy("save");
    try {
      const res = await api<{ quotation: Quote }>(`/api/quotations/${id}`, { method: "PUT", body: payload() });
      setData(res);
      hydrate(res.quotation);
      void audit.reload();
      if (!silent) toast.success("Draft saved. Totals recalculated by the server.");
      return res.quotation;
    } catch (e) {
      toast.error(errText(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function approveAndSend() {
    setConfirm(null);
    if (dirty && !(await save(true))) return;
    setBusy("approve");
    try {
      const res = await api<{ quotation: Quote; sent: boolean; error?: string; warnings: string[] }>(`/api/quotations/${id}/approve`, { body: { send: true } });
      setData({ quotation: res.quotation });
      hydrate(res.quotation);
      setWarnings(res.warnings ?? []);
      void audit.reload();
      if (res.sent) toast.success(`Approved and sent to ${q?.customer.name || phoneLabel(q?.customer.phone)} on WhatsApp`);
      else toast.error(`Approved, but WhatsApp delivery failed: ${res.error}. You can retry sending.`);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function retrySend() {
    setBusy("send");
    try {
      const res = await api<{ quotation: Quote; sent: boolean; error?: string }>(`/api/quotations/${id}/send`, { method: "POST", body: {} });
      setData({ quotation: res.quotation });
      void audit.reload();
      if (res.sent) toast.success("Quotation sent on WhatsApp");
      else toast.error(`Still could not send: ${res.error}`);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function simple(path: string, body: unknown, msg: string) {
    setBusy(path);
    try {
      const res = await api<{ quotation: Quote }>(`/api/quotations/${id}/${path}`, { body });
      setData({ quotation: res.quotation });
      void audit.reload();
      toast.success(msg);
      return res;
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function duplicate() {
    setBusy("dup");
    try {
      const res = await api<{ quotation: { id: string } }>(`/api/quotations/${id}/duplicate`, { method: "POST", body: {} });
      toast.success("Duplicated as a new draft");
      router.push(`/quotations/${res.quotation.id}`);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <Spinner />;
  if (!q) return <ErrorBanner message={error ?? "Quotation not found"} onRetry={reload} />;

  const t = calc?.ok ? calc.totals : null;
  const lineTotals = calc?.ok ? calc : null;
  const dis = !editable;
  const numCls = "w-24 text-right tabular-nums";

  return (
    <>
      <div className="mb-4"><Link href="/quotations" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Quotations</Link></div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{q.quoteNumber}</h1>
            <StatusBadge map={QUOTE_STATUS} status={q.status} />
            {q.source === "AI" && <Badge tone="indigo">Prepared by AI assistant</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">{q.createdBy ? `Created by ${q.createdBy.name}` : "Created automatically"}{q.approvedBy && ` - approved by ${q.approvedBy.name} ${dateTime(q.approvedAt)}`}{q.sentAt && ` - sent ${dateTime(q.sentAt)}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/quotations/${id}/pdf?inline=1`} target="_blank" rel="noreferrer"><Button variant="secondary"><ExternalLink className="h-4 w-4" /> {editable ? "Preview PDF" : "View PDF"}</Button></a>
          <a href={`/api/quotations/${id}/pdf`}><Button variant="secondary"><Download className="h-4 w-4" /> Download</Button></a>
          <Button variant="secondary" loading={busy === "dup"} onClick={duplicate}><Copy className="h-4 w-4" /> Duplicate</Button>
          {q.conversationId && <Link href={`/conversations?id=${q.conversationId}`}><Button variant="secondary"><MessageSquare className="h-4 w-4" /> Conversation</Button></Link>}
        </div>
      </div>

      {q.status === "APPROVED" && q.sendError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1"><p className="font-semibold">Approved, but not delivered to the customer</p><p className="break-words">{q.sendError}</p><p className="mt-1 text-xs text-red-600">The quotation is locked at the approved price. Nothing has been marked as sent.</p></div>
          <Button variant="danger" loading={busy === "send"} onClick={retrySend}><Repeat className="h-4 w-4" /> Retry sending</Button>
        </div>
      )}
      {q.status === "APPROVED" && !q.sendError && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"><span className="flex-1">This quotation is approved but has not been sent yet.</span><Button loading={busy === "send"} onClick={retrySend}><Send className="h-4 w-4" /> Send on WhatsApp</Button></div>
      )}
      {warnings.length > 0 && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">Warnings</p><ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      {!editable && <p className="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600">This quotation is {QUOTE_STATUS[q.status]?.label.toLowerCase()} and its prices are locked. Duplicate it to make changes.</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Customer">
          <p className="font-semibold text-slate-900">{q.customer.name || "Unnamed customer"}</p>
          <p className="text-sm text-slate-600">{phoneLabel(q.customer.phone)}</p>
          {q.customer.email && <p className="text-sm text-slate-600">{q.customer.email}</p>}
        </Card>
        <Card title="Vehicle">
          {q.vehicle ? (<><p className="font-semibold text-slate-900">{vehicleLabel(q.vehicle)}</p><p className="text-sm text-slate-600">{[q.vehicle.engine, q.vehicle.registrationNumber].filter(Boolean).join(" - ")}</p>{q.vehicle.vin && <p className="font-mono text-xs text-slate-500">{q.vehicle.vin}</p>}</>) : <p className="text-sm text-slate-500">No vehicle attached</p>}
        </Card>
        <Card title="Terms">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valid until"><Input type="date" disabled={dis} value={validUntil} onChange={(e) => { setValidUntil(e.target.value); setDirty(true); }} /></Field>
            <Field label="VAT"><p className="pt-2 text-sm text-slate-700">{vatDefault}% {q.pricesIncludeVat ? "(included in prices)" : "(added on top)"}</p></Field>
          </div>
        </Card>
      </div>

      <Card className="mt-6" padded={false} title="Parts" actions={editable && <Button size="sm" variant="secondary" onClick={() => setAddPart(true)}><Plus className="h-4 w-4" /> Add part</Button>}>
        {items.length === 0 ? <EmptyState title="No parts on this quotation" /> : (
          <Table>
            <thead><tr><Th>Description</Th><Th align="right">Qty</Th><Th align="right">Unit price</Th><Th align="right">Discount</Th><Th align="right">VAT %</Th><Th align="right">Line total</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i, idx) => (
                <tr key={i.key} className="align-top">
                  <Td className="min-w-[16rem]">
                    <Input disabled={dis} value={i.description} onChange={(e) => patchItem(i.key, { description: e.target.value })} aria-label="Description" />
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                      {[i.sku, i.partNumber].filter(Boolean).join(" / ")}
                      {i.fitmentConfidence && <Badge tone={CONF_TONE[i.fitmentConfidence] ?? "slate"}>fit: {i.fitmentConfidence.toLowerCase()}</Badge>}
                      {!i.partId && <Badge>custom</Badge>}
                    </div>
                    {i.matchNote && <p className="mt-1 text-xs text-amber-700">{i.matchNote}</p>}
                    {editable && i.alternatives && i.alternatives.length > 0 && (
                      <Select className="mt-1.5 !py-1 text-xs" value="" aria-label="Swap for another compatible option" onChange={(e) => {
                        const alt = i.alternatives!.find((a) => a.partId === e.target.value);
                        if (alt) patchItem(i.key, { partId: alt.partId, description: alt.name, sku: alt.sku, partNumber: alt.partNumber, unitPrice: String(num(alt.sellingPrice)), matchNote: `Swapped to ${alt.manufacturer ?? "alternative"} option` });
                      }}>
                        <option value="">Swap for another compatible option...</option>
                        {i.alternatives.map((a) => <option key={a.partId} value={a.partId}>{a.manufacturer ? `${a.manufacturer} - ` : ""}{a.name} ({money(a.sellingPrice, sym)}, {a.stock} in stock)</option>)}
                      </Select>
                    )}
                  </Td>
                  <Td align="right"><Input disabled={dis} type="number" min="0" step="1" className="w-20 text-right" value={i.quantity} onChange={(e) => patchItem(i.key, { quantity: e.target.value })} aria-label={`Quantity line ${idx + 1}`} /></Td>
                  <Td align="right"><Input disabled={dis} type="number" min="0" step="0.01" className={numCls} value={i.unitPrice} onChange={(e) => patchItem(i.key, { unitPrice: e.target.value })} aria-label={`Unit price line ${idx + 1}`} /></Td>
                  <Td align="right"><Input disabled={dis} type="number" min="0" step="0.01" className={numCls} value={i.discount} onChange={(e) => patchItem(i.key, { discount: e.target.value })} aria-label={`Discount line ${idx + 1}`} /></Td>
                  <Td align="right"><Input disabled={dis} type="number" min="0" max="100" className="w-20 text-right" placeholder={String(vatDefault)} value={i.vatRate} onChange={(e) => patchItem(i.key, { vatRate: e.target.value })} aria-label={`VAT line ${idx + 1}`} /></Td>
                  <Td align="right" className="pt-5 font-semibold">{lineTotals ? money(lineTotals.items[idx]?.total, sym) : "-"}</Td>
                  <Td>{editable && <Button size="sm" variant="ghost" aria-label={`Remove line ${idx + 1}`} onClick={() => { setItems((c) => c.filter((x) => x.key !== i.key)); setDirty(true); }}><Trash2 className="h-4 w-4 text-red-600" /></Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-6" padded={false} title="Labour" actions={editable && <Button size="sm" variant="secondary" onClick={() => setAddLabour(true)}><Plus className="h-4 w-4" /> Add labour</Button>}>
        {labour.length === 0 ? <EmptyState title="No labour on this quotation" /> : (
          <Table>
            <thead><tr><Th>Description</Th><Th align="right">Hours</Th><Th align="right">Rate</Th><Th align="right">VAT %</Th><Th align="right">Line total</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {labour.map((l, idx) => (
                <tr key={l.key}>
                  <Td className="min-w-[16rem]"><Input disabled={dis} value={l.description} onChange={(e) => patchLabour(l.key, { description: e.target.value })} aria-label="Labour description" /></Td>
                  <Td align="right"><Input disabled={dis} type="number" min="0" step="0.25" className="w-20 text-right" value={l.hours} onChange={(e) => patchLabour(l.key, { hours: e.target.value })} aria-label={`Hours line ${idx + 1}`} /></Td>
                  <Td align="right"><Input disabled={dis} type="number" min="0" step="0.01" className={numCls} value={l.unitPrice} onChange={(e) => patchLabour(l.key, { unitPrice: e.target.value })} aria-label={`Rate line ${idx + 1}`} /></Td>
                  <Td align="right"><Input disabled={dis} type="number" min="0" max="100" className="w-20 text-right" placeholder={String(vatDefault)} value={l.vatRate} onChange={(e) => patchLabour(l.key, { vatRate: e.target.value })} aria-label={`Labour VAT line ${idx + 1}`} /></Td>
                  <Td align="right" className="font-semibold">{lineTotals ? money(lineTotals.labour[idx]?.total, sym) : "-"}</Td>
                  <Td>{editable && <Button size="sm" variant="ghost" aria-label={`Remove labour ${idx + 1}`} onClick={() => { setLabour((c) => c.filter((x) => x.key !== l.key)); setDirty(true); }}><Trash2 className="h-4 w-4 text-red-600" /></Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Notes for the customer" ><Textarea disabled={dis} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="Shown on the PDF (e.g. fitting included, lead times)" /></Card>
          <Card title="Internal notes (never shown to the customer)"><Textarea disabled={dis} value={internalNotes} onChange={(e) => { setInternalNotes(e.target.value); setDirty(true); }} /></Card>
        </div>
        <Card title="Totals">
          {calc && !calc.ok ? <p className="text-sm text-red-600">{calc.message}</p> : (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Parts</dt><dd className="tabular-nums">{money(t?.subtotal, sym)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Labour</dt><dd className="tabular-nums">{money(t?.labourTotal, sym)}</dd></div>
              {num(t?.discount) > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd className="tabular-nums text-emerald-700">-{money(t?.discount, sym)}</dd></div>}
              <div className="flex justify-between"><dt className="text-slate-500">VAT {q.pricesIncludeVat ? "(included)" : ""}</dt><dd className="tabular-nums">{money(t?.vat, sym)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-bold"><dt>Total</dt><dd className="tabular-nums">{money(t?.total, sym)}</dd></div>
            </dl>
          )}
          {editable && <p className="mt-3 text-xs text-slate-400">Live preview. The server recalculates every total when you save or approve.</p>}
          {!editable && <p className="mt-3 text-xs text-slate-400">Locked totals: {money(q.total, sym)}</p>}
        </Card>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap gap-2">
          {q.status === "SENT" && (
            <>
              <Button variant="secondary" loading={busy === "send"} onClick={retrySend}><Send className="h-4 w-4" /> Resend PDF</Button>
              <Button variant="secondary" loading={busy === "respond"} onClick={() => void simple("respond", { decision: "ACCEPTED" }, "Marked as accepted")}><ThumbsUp className="h-4 w-4" /> Customer accepted</Button>
              <Button variant="secondary" loading={busy === "respond"} onClick={() => void simple("respond", { decision: "REJECTED" }, "Marked as declined")}><ThumbsDown className="h-4 w-4" /> Customer declined</Button>
            </>
          )}
          {["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"].includes(q.status) && <Button variant="ghost" onClick={() => setConfirm("cancel")}><XCircle className="h-4 w-4 text-red-600" /> Cancel quotation</Button>}
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
            <Button variant="secondary" loading={busy === "save"} disabled={!dirty} onClick={() => void save()}><Save className="h-4 w-4" /> Save draft</Button>
            <Button variant="success" loading={busy === "approve"} disabled={!calc?.ok || (items.length + labour.length === 0)} onClick={() => setConfirm("approve")}><CheckCircle2 className="h-4 w-4" /> Approve &amp; send</Button>
          </div>
        )}
      </div>

      <Card className="mt-6" padded={false} title="Audit trail">
        {!audit.data?.items.length ? <EmptyState title="No activity recorded yet" /> : (
          <ul className="divide-y divide-slate-100">
            {audit.data.items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                <Badge tone={a.actor === "AI" ? "indigo" : a.actor === "SYSTEM" ? "slate" : "orange"}>{a.actor === "USER" ? a.user?.name ?? "User" : a.actor}</Badge>
                <span className="flex-1 text-slate-700">{a.summary ?? a.action}</span>
                <span className="text-xs text-slate-400" title={dateTime(a.createdAt)}>{timeAgo(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AddPartModal open={addPart} onClose={() => setAddPart(false)} vehicleId={q.vehicle?.id ?? null} onAdd={(i) => { setItems((c) => [...c, i]); setDirty(true); }} />
      <AddLabourModal open={addLabour} onClose={() => setAddLabour(false)} onAdd={(l) => { setLabour((c) => [...c, l]); setDirty(true); }} />
      <ConfirmDialog open={confirm === "approve"} onClose={() => setConfirm(null)} confirmLabel="Approve & send" title="Approve and send this quotation?" onConfirm={approveAndSend} message={<><p>Prices are locked at <strong>{money(t?.total, sym)}</strong> and the PDF is sent to <strong>{q.customer.name || phoneLabel(q.customer.phone)}</strong> on WhatsApp.</p><p className="mt-2 text-xs text-slate-500">If delivery fails the quotation stays approved (not sent) and you can retry.</p></>} />
      <ConfirmDialog open={confirm === "cancel"} onClose={() => setConfirm(null)} danger confirmLabel="Cancel quotation" title="Cancel this quotation?" message="It will be marked as cancelled. The customer is not notified automatically." onConfirm={async () => { setConfirm(null); await simple("cancel", {}, "Quotation cancelled"); }} />
    </>
  );
}
