"use client";

import { FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, Checkbox, Modal, Select, Table, Td, Th, errText, useToast } from "@/components/ui";
import { api } from "@/lib/client";

interface Preview {
  headers: string[];
  sample: Record<string, string>[];
  totalRows: number;
  fields: { key: string; label: string; required: boolean }[];
  suggestedMapping: Record<string, string | null>;
}
interface Summary {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export function ImportWizard({ open, onClose, endpoint, title, allowUpdate, onDone }: { open: boolean; onClose: () => void; endpoint: string; title: string; allowUpdate?: boolean; onDone: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [updateExisting, setUpdateExisting] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setFile(null);
    setPreview(null);
    setSummary(null);
    setMapping({});
    if (fileRef.current) fileRef.current.value = "";
  }
  function close() {
    reset();
    onClose();
  }

  async function choose(f: File | null) {
    reset();
    if (!f) return;
    setFile(f);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", f);
      const p = await api<Preview>(`${endpoint}?action=preview`, { form });
      setPreview(p);
      setMapping(p.suggestedMapping);
    } catch (e) {
      toast.error(errText(e));
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  const missing = preview?.fields.filter((f) => f.required && !mapping[f.key]).map((f) => f.label) ?? [];

  async function commit() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mapping", JSON.stringify(mapping));
      form.set("updateExisting", String(updateExisting));
      const s = await api<Summary>(`${endpoint}?action=commit`, { form });
      setSummary(s);
      toast.success(`Import finished: ${s.created} created${s.updated ? `, ${s.updated} updated` : ""}`);
      onDone();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="xl"
      footer={
        summary ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button disabled={!preview || missing.length > 0} loading={busy && !!preview} onClick={commit}>Import {preview ? `${preview.totalRows} rows` : ""}</Button>
          </>
        )
      }
    >
      {summary ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Rows", summary.total], ["Created", summary.created], ["Updated", summary.updated], ["Skipped", summary.skipped]].map(([l, v]) => (
              <div key={l as string} className="rounded-lg bg-slate-50 p-3 text-center"><p className="text-2xl font-bold text-slate-900">{v}</p><p className="text-xs uppercase text-slate-500">{l}</p></div>
            ))}
          </div>
          {summary.errors.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-red-700">{summary.errors.length} row{summary.errors.length === 1 ? "" : "s"} could not be imported</p>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-800">
                {summary.errors.slice(0, 200).map((e) => <p key={e.row}>Row {e.row}: {e.message}</p>)}
              </div>
            </div>
          )}
        </div>
      ) : !preview ? (
        <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 px-6 py-12 text-center hover:border-brand-500 hover:bg-brand-50/40">
          <Upload className="h-8 w-8 text-slate-400" />
          <span className="text-sm font-medium text-slate-700">{busy ? "Reading file..." : "Choose a CSV or Excel (.xlsx) file"}</span>
          <span className="text-xs text-slate-500">You will map your columns to ours on the next step. Nothing is imported until you confirm.</span>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv" className="hidden" onChange={(e) => void choose(e.target.files?.[0] ?? null)} />
        </label>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-sm text-slate-600"><FileSpreadsheet className="h-4 w-4" /> {file?.name} <Badge>{preview.totalRows} rows</Badge><button className="ml-auto text-xs font-medium text-brand-700 hover:underline" onClick={reset}>Choose another file</button></div>
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">Match your columns</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {preview.fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">{f.label}{f.required && <span className="text-red-600"> *</span>}</span>
                  <Select value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })}>
                    <option value="">- Not in file -</option>
                    {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </label>
              ))}
            </div>
            {missing.length > 0 && <p className="mt-2 text-xs text-red-600">Map a column for: {missing.join(", ")}</p>}
          </div>
          {allowUpdate && <Checkbox label="Update existing items (matched by SKU)" hint="When off, rows whose SKU already exists are skipped." checked={updateExisting} onChange={setUpdateExisting} />}
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">Preview (first {preview.sample.length} rows)</p>
            <div className="rounded-lg border border-slate-200">
              <Table>
                <thead><tr>{preview.headers.map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">{preview.sample.map((r, i) => <tr key={i}>{preview.headers.map((h) => <Td key={h} className="max-w-[12rem] truncate">{r[h]}</Td>)}</tr>)}</tbody>
              </Table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
