"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DELIVERY_ENABLED } from "@/services/orders/features";

type Ticket = {
  id: string;
  orderNumber: string | null;
  status: "SENT_TO_KITCHEN" | "ACKNOWLEDGED" | "PREPARING" | "READY_FOR_COLLECTION";
  totalCents: number;
  notes: string | null;
  paymentStatus: "UNPAID" | "PENDING" | "PAID" | "FAILED";
  paymentMethod: string | null;
  fulfilment: "COLLECTION" | "DELIVERY" | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  deliveryFeeCents: number;
  confirmedAt: string | null;
  promisedReadyAt: string | null;
  customerName: string;
  items: { id: string; name: string; quantity: number; notes: string | null; isMeal: boolean | null; modifiers: string[] }[];
};

type HistoryTicket = {
  id: string;
  orderNumber: string | null;
  status: "COLLECTED";
  totalCents: number;
  notes: string | null;
  paymentStatus: "UNPAID" | "PENDING" | "PAID" | "FAILED";
  paymentMethod: string | null;
  fulfilment: "COLLECTION" | "DELIVERY" | null;
  deliveryAddress: string | null;
  deliveryFeeCents: number;
  confirmedAt: string | null;
  acknowledgedAt: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  dayKey: string | null;
  customerName: string;
  items: { id: string; name: string; quantity: number; notes: string | null; isMeal: boolean | null; modifiers: string[] }[];
};

type HistoryDay = {
  key: string;
  weekday: string;
  dayNum: string;
  isToday: boolean;
  isFuture: boolean;
};

type Board = {
  store: { name: string; defaultPrepMinutes: number; currencySymbol: string; deliveryFeeCents: number };
  orders: Ticket[];
};

type HistoryBoard = {
  store: { name: string; currencySymbol: string };
  since: string;
  weekStartsAt: string;
  weekEndsAt: string;
  weekLabel: string;
  weekResetsOn: string;
  todayKey: string;
  day: string | null;
  days: HistoryDay[];
  summary: {
    orderCount: number;
    collectedCount: number;
    collectedTotalCents: number;
  };
  orders: HistoryTicket[];
};

function money(cents: number, symbol: string) {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

function ago(iso: string | null) {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function clock(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(iso));
}

export default function KitchenPage() {
  const [tab, setTab] = useState<"live" | "history">("live");
  const [board, setBoard] = useState<Board | null>(null);
  const [history, setHistory] = useState<HistoryBoard | null>(null);
  const [historyDay, setHistoryDay] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [prep, setPrep] = useState<Record<string, string>>({});
  const [feeBusy, setFeeBusy] = useState(false);

  const loadLive = useCallback(async () => {
    const res = await fetch("/api/kitchen/orders", { cache: "no-store" });
    if (res.status === 401) {
      setNeedsLogin(true);
      setBoard(null);
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not load orders");
      return;
    }
    setNeedsLogin(false);
    setBoard(data);
    setError("");
  }, []);

  const loadHistory = useCallback(async (day: string | null = historyDay) => {
    const qs = day ? `?day=${encodeURIComponent(day)}` : "";
    const res = await fetch(`/api/kitchen/orders/history${qs}`, { cache: "no-store" });
    if (res.status === 401) {
      setNeedsLogin(true);
      setHistory(null);
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not load history");
      return;
    }
    setNeedsLogin(false);
    setHistory(data);
    setError("");
  }, [historyDay]);

  useEffect(() => {
    if (tab === "live") {
      void loadLive();
      const timer = setInterval(() => void loadLive(), 4000);
      return () => clearInterval(timer);
    }
    void loadHistory(historyDay);
    return undefined;
  }, [tab, historyDay, loadLive, loadHistory]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/kitchen/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not sign in");
      return;
    }
    setPin("");
    if (tab === "history") await loadHistory();
    else await loadLive();
  }

  async function changeDeliveryFee(change: { free: true } | { deltaCents: number }) {
    setFeeBusy(true);
    setError("");
    const res = await fetch("/api/kitchen/delivery-fee", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
    const data = await res.json().catch(() => ({}));
    setFeeBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not change the delivery price");
      return;
    }
    await loadLive();
  }

  async function act(id: string, action: string, extra: Record<string, unknown> = {}) {
    setBusyId(id);
    setError("");
    const res = await fetch(`/api/kitchen/orders/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "That did not go through");
      return;
    }
    await loadLive();
  }

  if (needsLogin) {
    return (
      <main className="kitchen-shell flex min-h-screen items-center justify-center px-4">
        <form onSubmit={login} className="w-full max-w-sm rounded-2xl bg-neutral-900 p-6 shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Kitchen</p>
          <h1 className="mt-2 text-2xl font-black">Mochachos Potch CBD</h1>
          <p className="mt-2 text-sm text-neutral-400">Enter the kitchen PIN to see incoming WhatsApp orders.</p>
          <input
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="mt-5 w-full rounded-xl border border-neutral-700 bg-black px-4 py-3 text-center text-2xl tracking-[0.4em]"
            placeholder="••••"
            aria-label="Kitchen PIN"
          />
          {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
          <button type="submit" className="mt-4 w-full rounded-xl bg-red-700 py-3 font-semibold">
            Open orders
          </button>
        </form>
      </main>
    );
  }

  if ((tab === "live" && !board) || (tab === "history" && !history)) {
    return (
      <main className="kitchen-shell flex min-h-screen items-center justify-center px-4">
        <p className="text-neutral-400">{error || "Loading…"}</p>
      </main>
    );
  }

  const storeName = board?.store.name ?? history?.store.name ?? "Kitchen";
  const symbol = board?.store.currencySymbol ?? history?.store.currencySymbol ?? "R";

  const incoming = board?.orders.filter((o) => o.status === "SENT_TO_KITCHEN") ?? [];
  const cooking = board?.orders.filter((o) => o.status === "ACKNOWLEDGED" || o.status === "PREPARING") ?? [];
  const ready = board?.orders.filter((o) => o.status === "READY_FOR_COLLECTION") ?? [];
  const columns = [
    { title: "New", hint: "Accept so the customer gets a time", tickets: incoming, tone: "new" },
    { title: "Cooking", hint: "Mark ready when it can be collected", tickets: cooking, tone: "" },
    { title: "Ready", hint: DELIVERY_ENABLED ? "Hand it over, or send the delivery" : "Hand it over", tickets: ready, tone: "ready" },
  ];

  return (
    <main className="kitchen-shell min-h-screen px-4 py-5">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">{storeName}</p>
          <h1 className="text-3xl font-black">Kitchen</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="kitchen-tabs" role="tablist" aria-label="Kitchen views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "live"}
              className={tab === "live" ? "active" : ""}
              onClick={() => setTab("live")}
            >
              Live
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "history"}
              className={tab === "history" ? "active" : ""}
              onClick={() => setTab("history")}
            >
              History
            </button>
          </div>
          <Link href="/promotions" className="rounded-full border border-neutral-600 px-4 py-2 text-sm">
            Promotions
          </Link>
          <button
            className="rounded-full border border-neutral-600 px-4 py-2 text-sm"
            onClick={async () => {
              await fetch("/api/kitchen/logout", { method: "POST" });
              setNeedsLogin(true);
              setBoard(null);
              setHistory(null);
            }}
          >
            Lock screen
          </button>
        </div>
      </header>
      {error ? <p className="mb-4 rounded-xl bg-red-950 px-4 py-3 text-red-200">{error}</p> : null}

      {tab === "live" && board ? (
        <>
          {DELIVERY_ENABLED ? (
            <section className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-700 bg-neutral-900 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">Delivery price</p>
                <p className="text-2xl font-black">
                  {board.store.deliveryFeeCents > 0 ? money(board.store.deliveryFeeCents, symbol) : "Free"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={feeBusy || board.store.deliveryFeeCents === 0}
                  className="rounded-lg border border-neutral-600 px-3 py-2 text-sm font-semibold disabled:opacity-40"
                  onClick={() => changeDeliveryFee({ deltaCents: -500 })}
                >
                  − R5
                </button>
                <button
                  type="button"
                  disabled={feeBusy}
                  className="rounded-lg border border-neutral-600 px-3 py-2 text-sm font-semibold disabled:opacity-40"
                  onClick={() => changeDeliveryFee({ deltaCents: 500 })}
                >
                  + R5
                </button>
                <button
                  type="button"
                  disabled={feeBusy || board.store.deliveryFeeCents === 0}
                  className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
                  onClick={() => changeDeliveryFee({ free: true })}
                >
                  Make free
                </button>
              </div>
            </section>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-3">
            {columns.map((column) => (
              <section key={column.title}>
                <h2 className="text-lg font-bold">
                  {column.title} <span className="text-neutral-500">{column.tickets.length}</span>
                </h2>
                <p className="mb-3 text-xs text-neutral-500">{column.hint}</p>
                <div className="flex flex-col gap-3">
                  {column.tickets.length === 0 ? <p className="text-sm text-neutral-600">Nothing here.</p> : null}
                  {column.tickets.map((ticket) => (
                    <article key={ticket.id} className={`ticket ${column.tone}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xl font-black">{ticket.orderNumber}</p>
                          <p className="text-sm text-neutral-400">
                            {ticket.customerName} · {ago(ticket.confirmedAt)}
                          </p>
                          {ticket.fulfilment === "DELIVERY" ? (
                            <div className="text-sm text-amber-200">
                              <p>
                                Delivery
                                {ticket.deliveryFeeCents > 0 ? ` ${money(ticket.deliveryFeeCents, symbol)}` : " · free"}
                                {ticket.deliveryAddress ? ` · ${ticket.deliveryAddress}` : ""}
                              </p>
                              {ticket.deliveryNotes ? <p>Driver note: {ticket.deliveryNotes}</p> : null}
                              {ticket.deliveryLatitude != null && ticket.deliveryLongitude != null ? (
                                <a
                                  className="underline"
                                  href={`https://www.google.com/maps?q=${ticket.deliveryLatitude},${ticket.deliveryLongitude}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open the pin
                                </a>
                              ) : null}
                            </div>
                          ) : ticket.fulfilment === "COLLECTION" ? (
                            <p className="text-sm text-amber-200">Collection</p>
                          ) : null}
                          {ticket.paymentStatus === "PAID" ? (
                            <p className="order-paid-badge">
                              Paid{ticket.paymentMethod ? ` · ${ticket.paymentMethod.replace(/_/g, " ")}` : " online"}
                            </p>
                          ) : (
                            <p className="text-xs text-neutral-500">Pay at till</p>
                          )}
                        </div>
                        <p className="font-semibold">{money(ticket.totalCents, symbol)}</p>
                      </div>
                      <ul className="mt-3 space-y-2 text-sm">
                        {ticket.items.map((item) => (
                          <li key={item.id}>
                            <span className="font-semibold">
                              {item.quantity} × {item.name}
                            </span>
                            {item.isMeal ? <span className="text-amber-200"> · meal</span> : null}
                            {item.modifiers.length ? <p className="text-neutral-400">{item.modifiers.join(" · ")}</p> : null}
                            {item.notes ? <p className="text-amber-100">Leave out: {item.notes}</p> : null}
                          </li>
                        ))}
                      </ul>
                      {ticket.notes ? <p className="mt-3 text-sm text-amber-100">Kitchen note: {ticket.notes}</p> : null}
                      {ticket.promisedReadyAt ? (
                        <p className="mt-2 text-xs text-neutral-400">Promised {clock(ticket.promisedReadyAt)}</p>
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {ticket.status === "SENT_TO_KITCHEN" ? (
                          <>
                            <label className="flex items-center gap-2 text-xs text-neutral-400">
                              Minutes
                              <input
                                inputMode="numeric"
                                value={prep[ticket.id] ?? String(board.store.defaultPrepMinutes)}
                                onChange={(e) => setPrep((p) => ({ ...p, [ticket.id]: e.target.value }))}
                                className="w-16 rounded-lg border border-neutral-700 bg-black px-2 py-2 text-center text-base text-white"
                                aria-label={`Prep minutes for ${ticket.orderNumber}`}
                              />
                            </label>
                            <button
                              disabled={busyId === ticket.id}
                              className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold"
                              onClick={() =>
                                act(ticket.id, "acknowledge", {
                                  prepMinutes: Number(prep[ticket.id] ?? board.store.defaultPrepMinutes) || board.store.defaultPrepMinutes,
                                })
                              }
                            >
                              Accept
                            </button>
                          </>
                        ) : null}
                        {ticket.status === "ACKNOWLEDGED" || ticket.status === "PREPARING" ? (
                          <button
                            disabled={busyId === ticket.id}
                            className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-black"
                            onClick={() => act(ticket.id, "ready")}
                          >
                            Ready to collect
                          </button>
                        ) : null}
                        {ticket.status === "READY_FOR_COLLECTION" ? (
                          <button
                            disabled={busyId === ticket.id}
                            className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black"
                            onClick={() => act(ticket.id, "collected")}
                          >
                            Collected
                          </button>
                        ) : null}
                        {ticket.status !== "READY_FOR_COLLECTION" ? (
                          <button
                            disabled={busyId === ticket.id}
                            className="rounded-lg border border-neutral-600 px-3 py-2 text-sm"
                            onClick={() =>
                              act(ticket.id, "reject", { reason: "Sorry, the kitchen cannot make this order right now." })
                            }
                          >
                            Cannot make it
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : null}

      {tab === "history" && history ? (
        <section className="kitchen-history">
          <div className="kitchen-history-summary">
            <div>
              <p className="label">
                {historyDay
                  ? `${history.days.find((d) => d.key === historyDay)?.weekday ?? "Day"}’s completed orders`
                  : "This week’s completed orders"}
              </p>
              <p className="value">{history.summary.collectedCount} collected</p>
              <p className="hint">{money(history.summary.collectedTotalCents, symbol)} total</p>
              <p className="kitchen-history-reset">
                {history.weekLabel} · resets Monday 00:00 (Johannesburg)
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-neutral-600 px-4 py-2 text-sm"
              onClick={() => void loadHistory(historyDay)}
            >
              Refresh
            </button>
          </div>
          <div className="kitchen-history-days" role="tablist" aria-label="Filter history by day">
            <button
              type="button"
              role="tab"
              aria-selected={historyDay === null}
              className={historyDay === null ? "active" : ""}
              onClick={() => setHistoryDay(null)}
            >
              All days
            </button>
            {history.days.map((day) => (
              <button
                key={day.key}
                type="button"
                role="tab"
                aria-selected={historyDay === day.key}
                disabled={day.isFuture}
                className={historyDay === day.key ? "active" : ""}
                onClick={() => setHistoryDay(day.key)}
              >
                <span className="weekday">{day.weekday}</span>
                <span className="daynum">{day.dayNum}</span>
                {day.isToday ? <span className="today">Today</span> : null}
              </button>
            ))}
          </div>
          {history.orders.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {historyDay
                ? "No completed orders on this day yet."
                : "No completed orders yet this week. When you mark an order Collected, the slip shows up here. History clears every Monday."}
            </p>
          ) : (
            <div className="kitchen-history-list">
              {history.orders.map((ticket) => (
                <article key={ticket.id} className="ticket history done">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xl font-black">{ticket.orderNumber}</p>
                      <p className="text-sm text-neutral-400">{ticket.customerName} · Collected</p>
                      <p className="text-xs text-neutral-500">
                        Confirmed {clock(ticket.confirmedAt)}
                        {ticket.collectedAt ? ` · Collected ${clock(ticket.collectedAt)}` : ""}
                      </p>
                      {ticket.fulfilment === "DELIVERY" ? (
                        <p className="text-sm text-amber-200">
                          Delivery
                          {ticket.deliveryFeeCents > 0 ? ` ${money(ticket.deliveryFeeCents, symbol)}` : " · free"}
                          {ticket.deliveryAddress ? ` · ${ticket.deliveryAddress}` : ""}
                        </p>
                      ) : ticket.fulfilment === "COLLECTION" ? (
                        <p className="text-sm text-amber-200">Collection</p>
                      ) : null}
                      {ticket.paymentStatus === "PAID" ? (
                        <p className="order-paid-badge">
                          Paid{ticket.paymentMethod ? ` · ${ticket.paymentMethod.replace(/_/g, " ")}` : " online"}
                        </p>
                      ) : (
                        <p className="text-xs text-neutral-500">Pay at till</p>
                      )}
                    </div>
                    <p className="font-semibold">{money(ticket.totalCents, symbol)}</p>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm">
                    {ticket.items.map((item) => (
                      <li key={item.id}>
                        <span className="font-semibold">
                          {item.quantity} × {item.name}
                        </span>
                        {item.isMeal ? <span className="text-amber-200"> · meal</span> : null}
                        {item.modifiers.length ? <p className="text-neutral-400">{item.modifiers.join(" · ")}</p> : null}
                        {item.notes ? <p className="text-amber-100">Leave out: {item.notes}</p> : null}
                      </li>
                    ))}
                  </ul>
                  {ticket.notes ? <p className="mt-3 text-sm text-amber-100">Kitchen note: {ticket.notes}</p> : null}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
