"use client";

import { Save, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Checkbox, ErrorBanner, Field, Input, PageHeader, Select, Spinner, Textarea, errText, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/client";

interface Business {
  name: string; tradingName: string | null; registrationNumber: string | null; vatNumber: string | null; address: string | null; phone: string | null; email: string | null;
  logoUrl: string | null; logoKey: string | null; whatsappNumber: string | null; whatsappPhoneNumberId: string | null; whatsappTokenConfigured: boolean;
  currencySymbol: string; currency: string; vatRate: number; pricesIncludeVat: boolean; quotePrefix: string; quoteValidityDays: number;
  optionDisplayMode: "CHEAPEST" | "RECOMMENDED" | "ALL" | "BUSINESS_SELECTED"; paymentDetails: string | null; termsAndConditions: string | null;
}

const MODES = [
  ["ALL", "Show all compatible options", "The customer sees every fitting, in-stock option with its price."],
  ["CHEAPEST", "Show the cheapest option only", "Only the lowest-priced compatible part is offered."],
  ["RECOMMENDED", "Show recommended parts only", "Only parts you flagged as Recommended in inventory (falls back to your review if none)."],
  ["BUSINESS_SELECTED", "I choose - customer sees no prices", "The assistant collects the request and you pick the parts when reviewing the quote."],
];

export default function SettingsPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ business: Business }>("/api/settings");
  const me = useApi<{ user: { role: string } }>("/api/auth/me");
  const [f, setF] = useState<Business | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const readOnly = me.data?.user.role === "STAFF";

  useEffect(() => {
    if (data) setF(data.business);
  }, [data]);

  if (loading && !f) return <Spinner />;
  if (!f) return <ErrorBanner message={error} onRetry={reload} />;
  const set = <K extends keyof Business>(k: K, v: Business[K]) => setF((cur) => (cur ? { ...cur, [k]: v } : cur));
  const text = (k: keyof Business, label: string, extra?: { hint?: string; type?: string; className?: string }) => (
    <Field label={label} hint={extra?.hint} className={extra?.className}>
      <Input type={extra?.type} disabled={readOnly} value={(f[k] as string | null) ?? ""} onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  );

  async function save() {
    if (!f) return;
    setBusy(true);
    try {
      const n = (v: string | null) => (v && v.trim() ? v.trim() : null);
      await api("/api/settings", {
        method: "PUT",
        body: {
          name: f.name, tradingName: n(f.tradingName), registrationNumber: n(f.registrationNumber), vatNumber: n(f.vatNumber), address: n(f.address), phone: n(f.phone), email: f.email ?? "",
          whatsappNumber: n(f.whatsappNumber), whatsappPhoneNumberId: n(f.whatsappPhoneNumberId), ...(token ? { whatsappAccessToken: token } : {}),
          currencySymbol: f.currencySymbol, currency: f.currency, vatRate: Number(f.vatRate), pricesIncludeVat: f.pricesIncludeVat, quotePrefix: f.quotePrefix,
          quoteValidityDays: Number(f.quoteValidityDays), optionDisplayMode: f.optionDisplayMode, paymentDetails: n(f.paymentDetails), termsAndConditions: n(f.termsAndConditions),
        },
      });
      setToken("");
      toast.success("Settings saved");
      void reload();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File | null) {
    if (!file) return;
    try {
      const form = new FormData();
      form.set("file", file);
      await api("/api/settings/logo", { form });
      toast.success("Logo updated");
      void reload();
    } catch (e) {
      toast.error(errText(e));
    }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle={readOnly ? "Only business admins can change settings" : "Business details, quoting rules and WhatsApp connection"} actions={!readOnly && <Button loading={busy} onClick={save}><Save className="h-4 w-4" /> Save settings</Button>} />
      <ErrorBanner message={error} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Business details">
          <div className="grid gap-4 sm:grid-cols-2">
            {text("name", "Legal name", { className: "sm:col-span-2" })}
            {text("tradingName", "Trading name", { hint: "Shown on quotations" })}
            {text("registrationNumber", "Registration number")}
            {text("vatNumber", "VAT number")}
            {text("phone", "Phone")}
            {text("email", "Email", { type: "email" })}
            <Field label="Address" className="sm:col-span-2"><Textarea disabled={readOnly} value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
            <div className="flex items-center gap-4 sm:col-span-2">
              {f.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={f.logoUrl} alt="Business logo" className="h-16 w-16 rounded-lg border border-slate-200 bg-white object-contain p-1" /> : <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">No logo</div>}
              <div>
                <input ref={logoRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => void uploadLogo(e.target.files?.[0] ?? null)} />
                <Button variant="secondary" disabled={readOnly} onClick={() => logoRef.current?.click()}><Upload className="h-4 w-4" /> Upload logo</Button>
                <p className="mt-1 text-xs text-slate-400">PNG or JPEG. Appears on the quotation PDF.</p>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Quotation rules">
          <div className="grid gap-4 sm:grid-cols-2">
            {text("quotePrefix", "Quote number prefix", { hint: "e.g. ECS gives ECS-2026-000001" })}
            <Field label="Validity (days)"><Input type="number" min="1" max="365" disabled={readOnly} value={f.quoteValidityDays} onChange={(e) => set("quoteValidityDays", Number(e.target.value))} /></Field>
            <Field label="VAT rate %"><Input type="number" min="0" max="100" step="0.01" disabled={readOnly} value={f.vatRate} onChange={(e) => set("vatRate", Number(e.target.value))} /></Field>
            <Field label="Currency symbol"><Input disabled={readOnly} maxLength={5} value={f.currencySymbol} onChange={(e) => set("currencySymbol", e.target.value)} /></Field>
            <div className="sm:col-span-2"><Checkbox label="My prices already include VAT" hint="When on, VAT is extracted from prices instead of added on top." checked={f.pricesIncludeVat} onChange={(v) => !readOnly && set("pricesIncludeVat", v)} /></div>
            <Field label="How many options may the assistant show customers?" className="sm:col-span-2">
              <Select disabled={readOnly} value={f.optionDisplayMode} onChange={(e) => set("optionDisplayMode", e.target.value as Business["optionDisplayMode"])}>
                {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <span className="mt-1 block text-xs text-slate-500">{MODES.find((m) => m[0] === f.optionDisplayMode)?.[2]} Nothing is ever called &quot;best&quot; unless you flagged it as recommended.</span>
            </Field>
          </div>
        </Card>

        <Card title="WhatsApp connection" actions={<Badge tone={f.whatsappPhoneNumberId && f.whatsappTokenConfigured ? "green" : "amber"}>{f.whatsappPhoneNumberId && f.whatsappTokenConfigured ? "Configured" : "Incomplete"}</Badge>}>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("whatsappNumber", "Business WhatsApp number", { hint: "Shown for reference, e.g. 27115550100" })}
            {text("whatsappPhoneNumberId", "Phone number ID", { hint: "From Meta WhatsApp Manager. Routes incoming messages to your business." })}
            <Field label="Access token" hint={f.whatsappTokenConfigured ? "A token is saved (encrypted). Enter a new one to replace it." : "Permanent system-user token. Stored encrypted, never shown again."} className="sm:col-span-2">
              <Input type="password" autoComplete="off" disabled={readOnly} value={token} placeholder={f.whatsappTokenConfigured ? "**************" : ""} onChange={(e) => setToken(e.target.value)} />
            </Field>
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 sm:col-span-2">Point your Meta webhook at <code className="rounded bg-white px-1 py-0.5 font-mono">{typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/whatsapp</code> and use your verify token from the server environment.</p>
          </div>
        </Card>

        <Card title="Quotation PDF content">
          <div className="space-y-4">
            <Field label="Payment details" hint="Bank details, payment reference instructions"><Textarea rows={4} disabled={readOnly} value={f.paymentDetails ?? ""} onChange={(e) => set("paymentDetails", e.target.value)} /></Field>
            <Field label="Terms & conditions"><Textarea rows={6} disabled={readOnly} value={f.termsAndConditions ?? ""} onChange={(e) => set("termsAndConditions", e.target.value)} /></Field>
          </div>
        </Card>
      </div>
    </>
  );
}
