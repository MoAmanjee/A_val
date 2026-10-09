import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { inboundButtonPayload, inboundListPayload, inboundTextPayload } from "@/services/whatsapp/payload";
import { processWebhookPayload } from "@/services/whatsapp/processor";
import { normalizePhone } from "@/utils/phone";
import type { OutboundMessage } from "@/services/whatsapp/types";

const DEFAULT_PHONE = "27820001111";
const DEFAULT_NAME = "You";

function playgroundEnabled() {
  return env.whatsappDriver === "mock";
}

function mediaHref(media: unknown): string | null {
  if (!media || typeof media !== "object") return null;
  const rec = media as { link?: string };
  if (typeof rec.link !== "string" || !rec.link) return null;
  try {
    const url = new URL(rec.link);
    return url.pathname + url.search;
  } catch {
    return rec.link;
  }
}

function viewMessage(row: {
  id: string;
  direction: string;
  sender: string;
  messageType: string;
  content: string;
  payload: unknown;
  createdAt: Date;
}) {
  const payload = (row.payload ?? null) as OutboundMessage | { replyId?: string } | null;
  const outbound = payload && typeof payload === "object" && "kind" in payload ? (payload as OutboundMessage) : null;
  return {
    id: row.id,
    direction: row.direction,
    sender: row.sender,
    messageType: row.messageType,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    kind: outbound?.kind ?? (row.direction === "INBOUND" ? "text" : "text"),
    buttons: outbound?.kind === "buttons" ? outbound.buttons : [],
    list:
      outbound?.kind === "list"
        ? { buttonLabel: outbound.buttonLabel, sections: outbound.sections, body: outbound.body }
        : null,
    imageSrc:
      outbound?.kind === "image"
        ? mediaHref(outbound.media)
        : outbound?.kind === "buttons"
          ? mediaHref(outbound.image)
          : null,
    caption: outbound?.kind === "image" || outbound?.kind === "document" ? outbound.caption ?? null : null,
    documentName: outbound?.kind === "document" ? outbound.filename : null,
    documentHref: outbound?.kind === "document" ? mediaHref(outbound.media) : null,
  };
}

async function loadTranscript(phone: string) {
  const store = await db.store.findFirst({ orderBy: { createdAt: "asc" } });
  if (!store) return { store: null, messages: [] as ReturnType<typeof viewMessage>[] };
  const conversation = await db.conversation.findUnique({
    where: { storeId_phone: { storeId: store.id, phone } },
  });
  if (!conversation) return { store: { name: store.tradingName || store.name }, messages: [] };
  const rows = await db.message.findMany({
    where: { conversationId: conversation.id, messageType: { not: "NOTE" } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return { store: { name: store.tradingName || store.name }, messages: rows.map(viewMessage) };
}

export async function GET(req: Request) {
  if (!playgroundEnabled()) {
    return Response.json({ error: "The playground only runs with WHATSAPP_DRIVER=mock." }, { status: 403 });
  }
  const url = new URL(req.url);
  const phone = normalizePhone(url.searchParams.get("phone") || DEFAULT_PHONE);
  const data = await loadTranscript(phone);
  return Response.json({ phone, ...data });
}

export async function POST(req: Request) {
  if (!playgroundEnabled()) {
    return Response.json({ error: "The playground only runs with WHATSAPP_DRIVER=mock." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    text?: unknown;
    replyId?: unknown;
    title?: unknown;
    list?: unknown;
    phone?: unknown;
    name?: unknown;
    reset?: unknown;
  } | null;

  const phone = normalizePhone(typeof body?.phone === "string" ? body.phone : DEFAULT_PHONE);
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : DEFAULT_NAME;

  if (body?.reset) {
    const store = await db.store.findFirst({ orderBy: { createdAt: "asc" } });
    if (store) {
      await db.conversation.deleteMany({ where: { storeId: store.id, phone } });
      await db.customer.deleteMany({ where: { storeId: store.id, phone } });
    }
    return Response.json({ phone, messages: [], store: store ? { name: store.tradingName || store.name } : null });
  }

  const store = await db.store.findFirst({ orderBy: { createdAt: "asc" } });
  if (!store?.whatsappPhoneNumberId) {
    return Response.json({ error: "Seed the database first (npm run local)." }, { status: 503 });
  }

  const replyId = typeof body?.replyId === "string" ? body.replyId : "";
  const title = typeof body?.title === "string" ? body.title : replyId;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  const payload = replyId
    ? body?.list
      ? inboundListPayload({ phoneNumberId: store.whatsappPhoneNumberId, from: phone, replyId, title, name })
      : inboundButtonPayload({ phoneNumberId: store.whatsappPhoneNumberId, from: phone, replyId, title, name })
    : inboundTextPayload({ phoneNumberId: store.whatsappPhoneNumberId, from: phone, text: text || "hi", name });

  const summary = await processWebhookPayload(payload);
  const data = await loadTranscript(phone);
  return Response.json({ phone, summary, ...data });
}
