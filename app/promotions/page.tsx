"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type WhatsAppStatus = { live: boolean; detail: string };
type PromotionRow = {
  id: string;
  body: string | null;
  priceCents: number | null;
  imageUrl: string | null;
  createdAt: string;
  sent: number;
  skipped: number;
  failed: number;
};
type Board = {
  whatsapp: WhatsAppStatus;
  audience: { messaged: number; insideWindow: number };
  promotions: PromotionRow[];
};

export default function PromotionsPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [price, setPrice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/promotions", { cache: "no-store" });
    if (res.status === 401) {
      setNeedsLogin(true);
      setBoard(null);
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not load promotions");
      return;
    }
    setNeedsLogin(false);
    setBoard(data);
    setError("");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function takeFile(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith("image/")) {
      setError("Use a JPEG, PNG, or WebP picture.");
      return;
    }
    setError("");
    setFile(next);
  }

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
    await load();
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult("");
    if (!text.trim() && !file && !price.trim()) {
      setError("Add a picture, some text, or a price.");
      return;
    }
    setBusy(true);
    const body = new FormData();
    if (text.trim()) body.set("text", text.trim());
    if (price.trim()) body.set("price", price.trim());
    if (file) body.set("image", file);
    const res = await fetch("/api/promotions", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "That did not send");
      return;
    }
    setResult(data.detail ?? "Saved.");
    setText("");
    setPrice("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    await load();
  }

  if (needsLogin || !board) {
    return (
      <main className="kitchen-shell flex min-h-screen items-center justify-center px-4">
        <form onSubmit={login} className="w-full max-w-sm rounded-2xl bg-neutral-900 p-6 shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Promotions</p>
          <h1 className="mt-2 text-2xl font-black">Mochachos Potch CBD</h1>
          <p className="mt-2 text-sm text-neutral-400">Enter the kitchen PIN to send a promotion.</p>
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
            Open promotions
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="kitchen-shell min-h-screen px-4 py-5">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">Mochachos Potch CBD</p>
          <h1 className="text-3xl font-black">Promotions</h1>
        </div>
        <Link href="/kitchen" className="rounded-full border border-neutral-600 px-4 py-2 text-sm">
          Kitchen
        </Link>
      </header>

      <p className={`mb-4 rounded-xl px-4 py-3 text-sm ${board.whatsapp.live ? "bg-emerald-950 text-emerald-100" : "bg-amber-950 text-amber-100"}`}>
        {board.whatsapp.detail}
      </p>

      <p className="mb-5 text-sm text-neutral-400">
        {board.audience.messaged} {board.audience.messaged === 1 ? "person has" : "people have"} messaged the shop.
        {" "}
        {board.audience.insideWindow} can receive a picture or note right now. WhatsApp only allows that for 24 hours after their last message. Add a price and they can tap Order this. It joins the basket and checks out like any other item.
      </p>

      <form onSubmit={send} className="max-w-xl rounded-2xl bg-neutral-900 p-5">
        <label className="block text-sm font-semibold" htmlFor="promo-text">
          Text, if you want words
        </label>
        <textarea
          id="promo-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="Half-price wings today until 8."
          className="mt-2 w-full rounded-xl border border-neutral-700 bg-black px-3 py-3 text-sm"
        />
        <label className="mt-4 block text-sm font-semibold" htmlFor="promo-price">
          Price, if they can order it
        </label>
        <input
          id="promo-price"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="49.90"
          aria-label="Promotion price in rands"
          className="mt-2 w-40 rounded-xl border border-neutral-700 bg-black px-3 py-3 text-sm"
        />
        <p className="mt-2 text-xs text-neutral-500">Leave this blank for a note with no order button. Rands, for example 49.90.</p>
        <label
          className="mt-4 block cursor-pointer rounded-xl border border-dashed border-neutral-600 px-4 py-8 text-center text-sm text-neutral-300"
          onPaste={(e) => {
            const image = [...e.clipboardData.files].find((item) => item.type.startsWith("image/"));
            if (!image) return;
            e.preventDefault();
            takeFile(image);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            takeFile(e.dataTransfer.files[0] ?? null);
          }}
        >
          Paste a picture here, or choose a file
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-3 block w-full text-xs"
            aria-label="Promotion picture"
            onChange={(e) => takeFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {preview ? (
          <img src={preview} alt="Promotion preview" className="mt-4 max-h-64 rounded-xl object-contain" />
        ) : null}
        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
        {result ? <p className="mt-3 text-sm text-emerald-300">{result}</p> : null}
        <button type="submit" disabled={busy} className="mt-4 rounded-xl bg-red-700 px-4 py-3 font-semibold disabled:opacity-60">
          {busy ? "Sending…" : "Send promotion"}
        </button>
      </form>

      <section className="mt-8 max-w-xl">
        <h2 className="text-lg font-bold">Already sent</h2>
        {board.promotions.length === 0 ? <p className="mt-2 text-sm text-neutral-500">Nothing yet.</p> : null}
        <ul className="mt-3 space-y-3">
          {board.promotions.map((promotion) => (
            <li key={promotion.id} className="rounded-xl bg-neutral-900 p-4 text-sm">
              {promotion.imageUrl ? (
                <img src={promotion.imageUrl} alt="" className="mb-3 max-h-40 rounded-lg object-contain" />
              ) : null}
              {promotion.body ? <p>{promotion.body}</p> : <p className="text-neutral-500">Picture only</p>}
              {promotion.priceCents != null ? (
                <p className="mt-1 font-semibold">R{(promotion.priceCents / 100).toFixed(2)} · customers can order it</p>
              ) : null}
              <p className="mt-2 text-xs text-neutral-400">
                {new Date(promotion.createdAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}
                {" · "}
                {promotion.sent} sent · {promotion.skipped} not sent · {promotion.failed} failed
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
