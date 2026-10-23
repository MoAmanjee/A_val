"use client";

import { Pencil, Plus, Power } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Spinner, Table, Td, Th, errText, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { money, num } from "@/lib/format";

interface Rate { id: string; name: string; description: string | null; hourlyRate: string | null; fixedPrice: string | null; defaultHours: string; active: boolean }

export default function LabourPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ items: Rate[] }>("/api/labour?all=1");
  const [editing, setEditing] = useState<(Partial<Rate> & { kind?: "hourly" | "fixed" }) | null>(null);
  const [busy, setBusy] = useState(false);

  function edit(r?: Rate) {
    setEditing(r ? { ...r, kind: num(r.fixedPrice) > 0 && !num(r.hourlyRate) ? "fixed" : "hourly" } : { kind: "hourly", defaultHours: "1", active: true });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const fixed = editing.kind === "fixed";
      const body = {
        name: editing.name,
        description: editing.description || null,
        hourlyRate: fixed ? null : num(editing.hourlyRate),
        fixedPrice: fixed ? num(editing.fixedPrice) : null,
        defaultHours: fixed ? 1 : num(editing.defaultHours) || 1,
        active: editing.active ?? true,
      };
      if (editing.id) await api(`/api/labour/${editing.id}`, { method: "PUT", body });
      else await api("/api/labour", { body });
      toast.success("Labour rate saved");
      setEditing(null);
      void reload();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: Rate) {
    try {
      await api(`/api/labour/${r.id}`, { method: "PUT", body: { active: !r.active } });
      void reload();
    } catch (e) {
      toast.error(errText(e));
    }
  }

  return (
    <>
      <PageHeader title="Labour rates" subtitle="Services and fitting charges the assistant and your team can add to quotations" actions={<Button onClick={() => edit()}><Plus className="h-4 w-4" /> Add labour rate</Button>} />
      <ErrorBanner message={error} onRetry={reload} />
      <Card padded={false}>
        {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState title="No labour rates yet" /> : (
          <Table>
            <thead><tr><Th>Service</Th><Th>Pricing</Th><Th align="right">Default hours</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((r) => {
                const fixed = num(r.fixedPrice) > 0 && !num(r.hourlyRate);
                return (
                  <tr key={r.id} className={r.active ? "" : "opacity-60"}>
                    <Td><p className="font-medium text-slate-900">{r.name}</p>{r.description && <p className="text-xs text-slate-500">{r.description}</p>}</Td>
                    <Td>{fixed ? `${money(r.fixedPrice)} fixed` : `${money(r.hourlyRate)} / hour`}</Td>
                    <Td align="right">{fixed ? "-" : num(r.defaultHours)}</Td>
                    <Td><Badge tone={r.active ? "green" : "slate"}>{r.active ? "Active" : "Inactive"}</Badge></Td>
                    <Td align="right"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => edit(r)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" aria-label={r.active ? `Deactivate ${r.name}` : `Activate ${r.name}`} onClick={() => toggle(r)}><Power className={`h-4 w-4 ${r.active ? "" : "text-emerald-600"}`} /></Button></div></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit labour rate" : "Add labour rate"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} disabled={!editing?.name} onClick={save}>Save</Button></>}>
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2"><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Brake replacement" /></Field>
            <Field label="Description" className="sm:col-span-2"><Input value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <Field label="Pricing type">
              <select className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as "hourly" | "fixed" })}><option value="hourly">Hourly rate</option><option value="fixed">Fixed price</option></select>
            </Field>
            {editing.kind === "fixed" ? (
              <Field label="Fixed price"><Input type="number" min="0" step="0.01" value={editing.fixedPrice ?? ""} onChange={(e) => setEditing({ ...editing, fixedPrice: e.target.value })} /></Field>
            ) : (
              <>
                <Field label="Rate per hour"><Input type="number" min="0" step="0.01" value={editing.hourlyRate ?? ""} onChange={(e) => setEditing({ ...editing, hourlyRate: e.target.value })} /></Field>
                <Field label="Default hours"><Input type="number" min="0.25" step="0.25" value={editing.defaultHours ?? "1"} onChange={(e) => setEditing({ ...editing, defaultHours: e.target.value })} /></Field>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
