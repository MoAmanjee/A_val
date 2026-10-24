"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

type WhatsAppStatus = { live: boolean; detail: string };
type Board = {
  whatsapp: WhatsAppStatus;
  audience: { messaged: number; insideWindow: number };
};

function formatPriceLabel(raw: string): string | null {
  const trimmed = raw.trim().replace(/^R\s*/i, "").replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return "Free";
  return `R${value.toFixed(2)}`;
}

function previewBody(text: string, priceLabel: string | null): string {
  const words = text.trim() || "Today's special";
  if (!priceLabel) return text.trim();
  return `${words}\n\n${priceLabel}\n\nTap Order this and I'll add it. You can add other items, then collect or get it delivered.`;
}

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const titleId = useId();

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

  useEffect(() => {
    if (!confirmOpen) return;
    cancelBtn.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        setConfirmOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [confirmOpen, busy]);

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

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult("");
    if (!text.trim() && !file && !price.trim()) {
      setError("Add a picture, some text, or a price.");
      return;
    }
    if (price.trim() && formatPriceLabel(price) == null) {
      setError("That price is not valid. Use rands, for example 49.90.");
      return;
    }
    setConfirmOpen(true);
  }

  function cancelConfirm() {
    if (busy) return;
    setConfirmOpen(false);
  }

  async function confirmSend() {
    setError("");
    setResult("");
    setBusy(true);
    const body = new FormData();
    if (text.trim()) body.set("text", text.trim());
    if (price.trim()) body.set("price", price.trim());
    if (file) body.set("image", file);
    const res = await fetch("/api/promotions", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setConfirmOpen(false);
      setError(data.error ?? "That did not send");
      return;
    }
    setConfirmOpen(false);
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

  const priceLabel = formatPriceLabel(price);
  const bodyPreview = previewBody(text, priceLabel);
  const audienceCount = board.audience.insideWindow;

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
        {audienceCount} can receive a picture or note right now. WhatsApp only allows that for 24 hours after their last message. Add a price and they can tap Order this. It joins the basket and checks out like any other item.
      </p>

      <form onSubmit={openConfirm} className="max-w-xl rounded-2xl bg-neutral-900 p-5">
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
          Preview &amp; send
        </button>
      </form>

      {confirmOpen ? (
        <div className="promo-confirm" role="presentation" onClick={cancelConfirm}>
          <div
            className="promo-confirm-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="promo-confirm-kicker">WhatsApp preview</p>
            <h2 id={titleId}>Send this promotion?</h2>
            <p className="promo-confirm-audience">
              Goes to {audienceCount} {audienceCount === 1 ? "customer" : "customers"} in the 24-hour window.
            </p>

            <div className="promo-wa-preview" aria-label="Message preview">
              <div className="promo-wa-bubble">
                {preview ? <img src={preview} alt="" className="promo-wa-image" /> : null}
                {bodyPreview ? (
                  <p className="promo-wa-text">
                    {bodyPreview.split("\n").map((line, i) => (
                      <span key={`${i}-${line.slice(0, 12)}`}>
                        {i > 0 ? <br /> : null}
                        {priceLabel && line === priceLabel ? <strong>{line}</strong> : line}
                      </span>
                    ))}
                  </p>
                ) : null}
                {!bodyPreview && !preview ? <p className="promo-wa-text text-neutral-500">Empty message</p> : null}
                {priceLabel ? (
                  <div className="promo-wa-buttons">
                    <span>Order this</span>
                    <span>Browse the menu</span>
                    <span>Type order</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="promo-confirm-actions">
              <button ref={cancelBtn} type="button" className="promo-confirm-cancel" disabled={busy} onClick={cancelConfirm}>
                Cancel — re-edit
              </button>
              <button type="button" className="promo-confirm-send" disabled={busy} onClick={() => void confirmSend()}>
                {busy ? "Sending…" : "Send now"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
