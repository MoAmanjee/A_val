"use client";

import { useCallback, useEffect, useState } from "react";

type BillingStatus = "ACTIVE" | "PAST_DUE" | "SUSPENDED";

interface OpsStore {
  id: string;
  name: string;
  tradingName: string | null;
  slug: string | null;
  variant: string;
  city: string;
  billingStatus: BillingStatus;
  whatsappEnabled: boolean;
  webEnabled: boolean;
  acceptingOrders: boolean;
  pausedReason: string | null;
  suspendedReason: string | null;
  monthlyMessageCap: number | null;
  usage: {
    inbound24h: number;
    outbound24h: number;
    failed24h: number;
    inbound7d: number;
    outbound7d: number;
    outboundMonth: number;
    cap: number | null;
    overCap: boolean;
  };
  health: { level: "healthy" | "warn" | "down"; label: string; detail: string };
  whatsapp: { live: boolean; detail: string };
}

export default function OpsPage() {
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<OpsStore[]>([]);
  const [busy, setBusy] = useState(false);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/ops/stores");
    if (res.status === 401) {
      setAuthed(false);
      return false;
    }
    const data = (await res.json().catch(() => null)) as { stores?: OpsStore[]; error?: string } | null;
    if (!res.ok) {
      setError(data?.error ?? "Could not load stores. Try again in a moment.");
      return false;
    }
    setStores(data?.stores ?? []);
    setAuthed(true);
    setError(null);
    return true;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/ops/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Sign-in failed.");
      return;
    }
    setPin("");
    await load();
  }

  async function logout() {
    await fetch("/api/ops/logout", { method: "POST" });
    setAuthed(false);
    setStores([]);
  }

  async function patch(storeId: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/ops/stores", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeId, ...body }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Update failed.");
      return;
    }
    await load();
  }

  if (!authed) {
    return (
      <main className="ops-shell">
        <form className="ops-login" onSubmit={login}>
          <p className="ops-kicker">Platform control</p>
          <h1>Ops console</h1>
          <p>Monitor message usage, health, and cut off a site when they stop paying.</p>
          <label>
            Ops PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={8}
            />
          </label>
          {error ? <p className="ops-error">{error}</p> : null}
          <button type="submit" disabled={busy || pin.length < 4}>
            Open console
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="ops-shell">
      <header className="ops-header">
        <div>
          <p className="ops-kicker">Platform control</p>
          <h1>Sites</h1>
          <p>Usage, health, WhatsApp / web kill switches, billing cut-off.</p>
        </div>
        <div className="ops-header-actions">
          <button type="button" className="ops-ghost" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
          <button type="button" className="ops-ghost" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>

      {error ? <p className="ops-error ops-banner">{error}</p> : null}

      <div className="ops-grid">
        {stores.map((store) => (
          <article key={store.id} className={`ops-card health-${store.health.level}`}>
            <div className="ops-card-top">
              <div>
                <h2>{store.tradingName || store.name}</h2>
                <p className="ops-meta">
                  {store.city} · {store.slug ?? "no-slug"} · variant {store.variant}
                </p>
              </div>
              <span className={`ops-pill ${store.health.level}`}>{store.health.label}</span>
            </div>
            <p className="ops-detail">{store.health.detail}</p>
            <p className="ops-detail">{store.whatsapp.detail}</p>

            <dl className="ops-stats">
              <div>
                <dt>Out today</dt>
                <dd>{store.usage.outbound24h}</dd>
              </div>
              <div>
                <dt>In today</dt>
                <dd>{store.usage.inbound24h}</dd>
              </div>
              <div>
                <dt>Out 7d</dt>
                <dd>{store.usage.outbound7d}</dd>
              </div>
              <div>
                <dt>Out month</dt>
                <dd>
                  {store.usage.outboundMonth}
                  {store.usage.cap != null ? ` / ${store.usage.cap}` : ""}
                </dd>
              </div>
              <div>
                <dt>Failed today</dt>
                <dd>{store.usage.failed24h}</dd>
              </div>
            </dl>

            <div className="ops-toggles">
              <label>
                <input
                  type="checkbox"
                  checked={store.whatsappEnabled}
                  disabled={busy}
                  onChange={(e) => void patch(store.id, { whatsappEnabled: e.target.checked })}
                />
                WhatsApp on
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={store.webEnabled}
                  disabled={busy}
                  onChange={(e) => void patch(store.id, { webEnabled: e.target.checked })}
                />
                Web /order on
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={store.acceptingOrders}
                  disabled={busy}
                  onChange={(e) => void patch(store.id, { acceptingOrders: e.target.checked })}
                />
                Kitchen accepting
              </label>
            </div>

            <div className="ops-billing">
              <label>
                Billing
                <select
                  value={store.billingStatus}
                  disabled={busy}
                  onChange={(e) =>
                    void patch(store.id, {
                      billingStatus: e.target.value,
                      suspendedReason:
                        e.target.value === "SUSPENDED"
                          ? reasonDraft[store.id] || store.suspendedReason || "Account suspended — payment needed."
                          : store.suspendedReason,
                    })
                  }
                >
                  <option value="ACTIVE">Active (paying)</option>
                  <option value="PAST_DUE">Past due (warn)</option>
                  <option value="SUSPENDED">Suspended (cut off)</option>
                </select>
              </label>
              <label>
                Cut-off / suspend reason
                <input
                  value={reasonDraft[store.id] ?? store.suspendedReason ?? ""}
                  onChange={(e) => setReasonDraft((prev) => ({ ...prev, [store.id]: e.target.value }))}
                  onBlur={() => {
                    const next = reasonDraft[store.id];
                    if (next === undefined || next === (store.suspendedReason ?? "")) return;
                    void patch(store.id, { suspendedReason: next || null });
                  }}
                  placeholder="Shown when WhatsApp or web is blocked"
                />
              </label>
            </div>

            <div className="ops-actions">
              <button
                type="button"
                className="ops-danger"
                disabled={busy || store.billingStatus === "SUSPENDED"}
                onClick={() =>
                  void patch(store.id, {
                    billingStatus: "SUSPENDED",
                    whatsappEnabled: false,
                    webEnabled: false,
                    suspendedReason:
                      reasonDraft[store.id] || store.suspendedReason || "Account suspended — payment needed.",
                  })
                }
              >
                Cut off (non-payment)
              </button>
              <button
                type="button"
                className="ops-ok"
                disabled={busy || (store.billingStatus === "ACTIVE" && store.whatsappEnabled && store.webEnabled)}
                onClick={() =>
                  void patch(store.id, {
                    billingStatus: "ACTIVE",
                    whatsappEnabled: true,
                    webEnabled: true,
                    acceptingOrders: true,
                    suspendedReason: null,
                  })
                }
              >
                Restore service
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
