"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Button = { id: string; title: string };
type ListRow = { id: string; title: string; description?: string };
type ChatMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  kind: string;
  buttons: Button[];
  list: { buttonLabel: string; sections: { title?: string; rows: ListRow[] }[]; body: string } | null;
  imageSrc: string | null;
  caption: string | null;
  documentName: string | null;
  documentHref: string | null;
};

const PHONE = "27820001111";
const NAME = "You";

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [storeName, setStoreName] = useState("Mochachos Potch CBD");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [listOpen, setListOpen] = useState<ChatMessage["list"]>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/playground?phone=${PHONE}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not load the chat");
      return;
    }
    setMessages(data.messages ?? []);
    if (data.store?.name) setStoreName(data.store.name);
    setError("");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setListOpen(null);
    const res = await fetch("/api/playground", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: PHONE, name: NAME, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "That message did not go through");
      return;
    }
    setMessages(data.messages ?? []);
    if (data.store?.name) setStoreName(data.store.name);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    await send({ text });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col bg-[#ece5dd]">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white shadow">
        <Link href="/" className="text-sm text-white/80">
          ←
        </Link>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#128c7e] text-sm font-bold">M</div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{storeName}</p>
          <p className="text-xs text-white/80">Local playground · not a live WhatsApp number</p>
        </div>
        <Link href="/kitchen" className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
          Kitchen
        </Link>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {messages.length === 0 && !busy && (
          <p className="mx-auto max-w-xs rounded-xl bg-white/90 px-4 py-3 text-center text-sm text-neutral-600 shadow">
            This is you, on WhatsApp. Type <strong>hi</strong> to get the menu pictures, or send a full order such as
            “hot quarter chicken meal with a Coke, collection”.
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} disabled={busy} onTap={(id, title, list) => void send({ replyId: id, title, list })} onOpenList={setListOpen} />
        ))}
        {busy && <p className="text-center text-xs text-neutral-500">typing…</p>}
        <div ref={bottom} />
      </div>

      {error && <p className="px-4 pb-2 text-center text-sm text-red-800">{error}</p>}

      {listOpen && (
        <div className="border-t border-neutral-200 bg-white px-3 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{listOpen.buttonLabel}</p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {listOpen.sections.flatMap((section) =>
              section.rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void send({ replyId: row.id, title: row.title, list: true })}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-100 disabled:opacity-50"
                >
                  <span className="font-medium">{row.title}</span>
                  {row.description && <span className="mt-0.5 block text-xs text-neutral-500">{row.description}</span>}
                </button>
              )),
            )}
          </div>
          <button type="button" className="mt-2 w-full text-xs text-neutral-500" onClick={() => setListOpen(null)}>
            Close
          </button>
        </div>
      )}

      <form onSubmit={onSubmit} className="sticky bottom-0 flex gap-2 bg-[#f0f0f0] px-3 py-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message"
          className="flex-1 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="rounded-full bg-[#128c7e] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Send
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send({ reset: true })}
          className="rounded-full border border-neutral-300 bg-white px-3 py-2 text-xs"
        >
          New
        </button>
      </form>
    </main>
  );
}

function Bubble({
  message,
  disabled,
  onTap,
  onOpenList,
}: {
  message: ChatMessage;
  disabled: boolean;
  onTap: (id: string, title: string, list?: boolean) => void;
  onOpenList: (list: ChatMessage["list"]) => void;
}) {
  const mine = message.direction === "INBOUND";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow ${mine ? "bg-[#dcf8c6]" : "bg-white"}`}>
        {message.imageSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={message.imageSrc} alt={message.caption ?? "Menu"} className="mb-2 max-h-64 w-full rounded object-cover" />
        )}
        {message.documentHref && (
          <a href={message.documentHref} className="mb-1 block text-xs font-semibold text-[#075e54] underline" target="_blank" rel="noreferrer">
            {message.documentName ?? "Menu PDF"}
          </a>
        )}
        <p className="whitespace-pre-wrap">{message.kind === "list" ? message.list?.body ?? message.content : message.content}</p>
        {message.buttons.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {message.buttons.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={disabled}
                onClick={() => onTap(b.id, b.title)}
                className="rounded-md border border-[#128c7e]/30 bg-[#128c7e]/10 px-2 py-1.5 text-left text-xs font-semibold text-[#075e54] disabled:opacity-50"
              >
                {b.title}
              </button>
            ))}
          </div>
        )}
        {message.list && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onOpenList(message.list)}
            className="mt-2 w-full rounded-md bg-[#075e54] px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {message.list.buttonLabel}
          </button>
        )}
      </div>
    </div>
  );
}
