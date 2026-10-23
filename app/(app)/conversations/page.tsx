"use client";

import { AlertTriangle, Bot, Check, CheckCheck, FilePlus2, FileText, Paperclip, RotateCcw, Send, StickyNote, UserRound, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Badge, Button, EmptyState, ErrorBanner, SearchInput, Select, Spinner, StatusBadge, Textarea, errText, useToast } from "@/components/ui";
import { api, qs, useApi, useDebounced } from "@/lib/client";
import { CONVERSATION_STATUS, QUOTE_STATUS, dateTime, money, phoneLabel, timeAgo, vehicleLabel } from "@/lib/format";

interface ListItem {
  id: string;
  status: string;
  handler: string;
  unreadCount: number;
  lastMessageAt: string;
  customer: { id: string; name: string | null; phone: string };
  vehicle: { year: number | null; make: string | null; model: string | null; variant: string | null } | null;
  messages: { content: string; direction: string; messageType: string }[];
  quotations: { id: string; quoteNumber: string; status: string }[];
}
interface Msg {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  sender: "CUSTOMER" | "AI" | "BUSINESS" | "SYSTEM";
  messageType: string;
  content: string;
  deliveryStatus: string;
  error: string | null;
  createdAt: string;
}
interface Detail {
  id: string;
  status: string;
  handler: string;
  humanReason: string | null;
  customer: { id: string; name: string | null; phone: string; email: string | null };
  vehicle: { year: number | null; make: string | null; model: string | null; variant: string | null; engine: string | null; vin: string | null } | null;
  messages: Msg[];
  quotations: { id: string; quoteNumber: string; status: string; total: string; sendError: string | null }[];
  partRequests: { id: string; description: string; status: string }[];
}

function Ticks({ m }: { m: Msg }) {
  if (m.deliveryStatus === "FAILED") return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
  if (m.deliveryStatus === "READ") return <CheckCheck className="h-3.5 w-3.5 text-sky-500" />;
  if (m.deliveryStatus === "DELIVERED") return <CheckCheck className="h-3.5 w-3.5 text-slate-400" />;
  if (m.deliveryStatus === "SENT") return <Check className="h-3.5 w-3.5 text-slate-400" />;
  return <span className="text-[10px] text-slate-400">sending</span>;
}

function Bubble({ m, onRetry }: { m: Msg; onRetry: (id: string) => void }) {
  if (m.messageType === "NOTE") {
    return (
      <div className="mx-auto my-2 max-w-[85%] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm">
        <p className="mb-0.5 flex items-center gap-1 font-semibold"><StickyNote className="h-3 w-3" /> Internal note - not sent to the customer</p>
        <p className="whitespace-pre-wrap break-words">{m.content}</p>
        <p className="mt-1 text-[10px] text-amber-700/70">{dateTime(m.createdAt)}</p>
      </div>
    );
  }
  const out = m.direction === "OUTBOUND";
  return (
    <div className={`my-1 flex ${out ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${out ? (m.sender === "AI" ? "rounded-br-sm bg-[#d9fdd3]" : "rounded-br-sm bg-[#cfe9ff]") : "rounded-bl-sm bg-white"}`}>
        {out && <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{m.sender === "AI" ? <><Bot className="h-3 w-3" /> AI assistant</> : <><UserRound className="h-3 w-3" /> Team</>}</p>}
        {m.messageType === "DOCUMENT" ? (
          <p className="flex items-center gap-2"><Paperclip className="h-4 w-4 text-slate-500" /><span className="whitespace-pre-wrap break-words">{m.content}</span></p>
        ) : m.messageType !== "TEXT" ? (
          <p className="italic text-slate-500">[{m.messageType.toLowerCase()} message]{m.content && !m.content.startsWith("[") ? ` ${m.content}` : ""}</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-slate-900">{m.content}</p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-slate-400">
          <span>{new Date(m.createdAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</span>
          {out && <Ticks m={m} />}
        </div>
        {out && m.deliveryStatus === "FAILED" && (
          <div className="mt-1 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
            <p className="break-words">Not delivered: {m.error ?? "unknown error"}</p>
            <button onClick={() => onRetry(m.id)} className="mt-1 inline-flex items-center gap-1 font-semibold underline"><RotateCcw className="h-3 w-3" /> Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const selected = params.get("id");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const list = useApi<{ items: ListItem[]; total: number }>(`/api/conversations${qs({ q: dq, status, pageSize: 60 })}`);
  const detail = useApi<{ conversation: Detail }>(selected ? `/api/conversations/${selected}` : null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const reloadList = list.reload;
  const reloadDetail = detail.reload;

  useEffect(() => {
    const t = setInterval(() => {
      void reloadList();
      if (selected) void reloadDetail();
    }, 8000);
    return () => clearInterval(t);
  }, [reloadList, reloadDetail, selected]);

  const c = detail.data?.conversation;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [c?.messages.length, selected]);
  useEffect(() => setText(""), [selected]);

  const open = (id: string) => router.replace(`/conversations${qs({ id, status })}`);

  async function run<T>(key: string, fn: () => Promise<T>, ok?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const handler = (action: string, ok: string) => run(action, async () => { await api(`/api/conversations/${selected}/handler`, { body: { action } }); await Promise.all([detail.reload(), list.reload()]); }, ok);

  async function send() {
    const body = text.trim();
    if (!body) return;
    const r = await run("send", async () => {
      const res = await api<{ sent: boolean; error?: string }>(`/api/conversations/${selected}/messages`, { body: { text: body } });
      setText("");
      await Promise.all([detail.reload(), list.reload()]);
      return res;
    });
    if (r && !r.sent) toast.error(`Message saved but not delivered: ${r.error}`);
  }

  const retry = (mid: string) => run("retry", async () => {
    const res = await api<{ sent: boolean; error?: string }>(`/api/conversations/${selected}/messages/${mid}/retry`, { method: "POST", body: {} });
    if (res.sent) toast.success("Message delivered"); else toast.error(`Still failing: ${res.error}`);
    await detail.reload();
  });

  const createQuote = () => run("quote", async () => {
    const res = await api<{ quotation: { id: string }; created: boolean }>(`/api/conversations/${selected}/quote`, { method: "POST", body: {} });
    router.push(`/quotations/${res.quotation.id}`);
  });

  const aiPaused = c?.handler === "HUMAN" || c?.status === "HUMAN_REQUIRED";

  return (
    <div className="-m-4 flex h-[calc(100vh-57px)] overflow-hidden bg-white sm:-m-6 lg:-m-8 lg:h-screen">
      <div className={`flex w-full flex-col border-r border-slate-200 md:w-80 lg:w-96 md:flex ${selected ? "hidden" : "flex"}`}>
        <div className="space-y-2 border-b border-slate-100 p-3">
          <h1 className="text-lg font-bold text-slate-900">Conversations</h1>
          <SearchInput value={q} onChange={setQ} placeholder="Name, phone or vehicle" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="">All conversations</option>
            <option value="OPEN">Open</option>
            {Object.entries(CONVERSATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </div>
        <ErrorBanner message={list.error} onRetry={list.reload} />
        <div className="flex-1 overflow-y-auto">
          {list.loading && !list.data ? <Spinner /> : !list.data?.items.length ? <EmptyState title="No conversations" hint="Customer WhatsApp chats appear here." /> : (
            <ul className="divide-y divide-slate-100">
              {list.data.items.map((i) => (
                <li key={i.id}>
                  <button onClick={() => open(i.id)} className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${selected === i.id ? "bg-brand-50" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{i.customer.name || phoneLabel(i.customer.phone)}</p>
                      <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(i.lastMessageAt)}</span>
                    </div>
                    <p className="truncate text-xs text-slate-500">{vehicleLabel(i.vehicle)}</p>
                    <p className="mt-0.5 truncate text-sm text-slate-600">{i.messages[0] ? `${i.messages[0].direction === "OUTBOUND" ? "You: " : ""}${i.messages[0].content}` : "No messages"}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge map={CONVERSATION_STATUS} status={i.status} />
                      {i.unreadCount > 0 && <Badge tone="orange">{i.unreadCount} new</Badge>}
                      {i.quotations[0] && <Badge tone="slate">{i.quotations[0].quoteNumber}</Badge>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={`min-w-0 flex-1 flex-col ${selected ? "flex" : "hidden md:flex"}`}>
        {!selected ? (
          <div className="m-auto text-center text-sm text-slate-500">Select a conversation to read it and reply.</div>
        ) : detail.loading && !c ? <Spinner /> : !c ? <ErrorBanner message={detail.error ?? "Conversation not found"} onRetry={detail.reload} /> : (
          <>
            <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <button className="text-sm text-slate-500 md:hidden" onClick={() => router.replace("/conversations")}>Back</button>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{c.customer.name || "Unnamed customer"} <span className="font-normal text-slate-500">{phoneLabel(c.customer.phone)}</span></p>
                <p className="truncate text-xs text-slate-500">{vehicleLabel(c.vehicle)}{c.vehicle?.engine ? ` - ${c.vehicle.engine}` : ""}{c.vehicle?.vin ? ` - VIN ${c.vehicle.vin}` : ""}</p>
              </div>
              <StatusBadge map={CONVERSATION_STATUS} status={c.status} />
              <Badge tone={aiPaused ? "amber" : "green"}>{aiPaused ? "AI paused" : "AI replying"}</Badge>
              <div className="flex flex-wrap gap-2">
                {aiPaused ? <Button size="sm" variant="secondary" loading={busy === "resume_ai"} onClick={() => void handler("resume_ai", "AI assistant resumed")}><Bot className="h-4 w-4" /> Resume AI</Button> : <Button size="sm" variant="secondary" loading={busy === "take_over"} onClick={() => void handler("take_over", "You have taken over. The AI will not reply.")}><UserRound className="h-4 w-4" /> Take over</Button>}
                <Button size="sm" loading={busy === "quote"} onClick={() => void createQuote()}><FilePlus2 className="h-4 w-4" /> {c.quotations.some((x) => ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(x.status)) ? "Open quote" : "Create quote"}</Button>
                {["COMPLETED", "CLOSED"].includes(c.status) ? <Button size="sm" variant="ghost" onClick={() => void handler("reopen", "Conversation reopened")}>Reopen</Button> : <Button size="sm" variant="ghost" onClick={() => void handler("complete", "Marked as completed")}>Complete</Button>}
              </div>
            </header>

            {c.status === "HUMAN_REQUIRED" && (
              <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>A person is needed here{c.humanReason ? `: ${c.humanReason}` : "."} The AI has stopped replying. Reply below, or resume the AI when you are done.</span></div>
            )}

            <div className="chat-bg flex-1 overflow-y-auto px-4 py-4">
              {c.messages.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No messages yet.</p>}
              {c.messages.map((m) => <Bubble key={m.id} m={m} onRetry={(id) => void retry(id)} />)}
              <div ref={bottom} />
            </div>

            {(c.quotations.length > 0 || c.partRequests.length > 0) && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
                {c.quotations.map((qt) => (
                  <Link key={qt.id} href={`/quotations/${qt.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 hover:border-brand-500">
                    <FileText className="h-3 w-3" /> {qt.quoteNumber} - {money(qt.total)} <StatusBadge map={QUOTE_STATUS} status={qt.status} />
                  </Link>
                ))}
                {c.partRequests.map((p) => <Link key={p.id} href="/part-requests" className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-900">Part request: {p.description} ({p.status.toLowerCase().replace("_", " ")})</Link>)}
              </div>
            )}

            <div className="border-t border-slate-200 bg-white p-3">
              {!aiPaused && <p className="mb-2 flex items-center gap-1 text-xs text-slate-500"><Lock className="h-3 w-3" /> Sending a message pauses the AI assistant for this conversation.</p>}
              <div className="flex items-end gap-2">
                <Textarea rows={2} className="min-h-[44px] flex-1 resize-none" value={text} placeholder="Type a reply to the customer..." onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
                <Button loading={busy === "send"} disabled={!text.trim()} onClick={() => void send()}><Send className="h-4 w-4" /> Send</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ConversationsPage() {
  return <Suspense fallback={<Spinner />}><ConversationsInner /></Suspense>;
}
