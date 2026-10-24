import { env } from "@/lib/env";
import { WA_LIMITS, clamp } from "@/services/whatsapp/limits";
import {
  WhatsAppError,
  type InboundMessage,
  type OutboundMessage,
  type ParsedWebhook,
  type SendResult,
  type StatusUpdate,
  type WhatsAppCredentials,
  type WhatsAppService,
} from "@/services/whatsapp/types";

interface GraphError {
  error?: { message?: string; code?: number; error_data?: { details?: string } };
}

type WebhookPayload = {
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: Record<string, unknown>[];
        statuses?: Record<string, unknown>[];
      };
    }[];
  }[];
};

/** Official WhatsApp Business Cloud API (Graph API) implementation. */
export class CloudApiWhatsAppService implements WhatsAppService {
  readonly name = "cloud";

  private base(creds: WhatsAppCredentials) {
    return `https://graph.facebook.com/${env.whatsappGraphVersion}/${creds.phoneNumberId}`;
  }

  private async request(creds: WhatsAppCredentials, path: string, init: RequestInit): Promise<Record<string, unknown>> {
    if (!creds.accessToken) throw new WhatsAppError("WhatsApp access token is not configured", false);
    if (!creds.phoneNumberId) throw new WhatsAppError("WhatsApp phone number ID is not configured", false);
    let res: Response;
    try {
      res = await fetch(`${this.base(creds)}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${creds.accessToken}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new WhatsAppError(`Could not reach WhatsApp API: ${e instanceof Error ? e.message : String(e)}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & GraphError;
    if (!res.ok) {
      const g = body.error;
      const msg = g?.error_data?.details ?? g?.message ?? `HTTP ${res.status}`;
      throw new WhatsAppError(
        `WhatsApp API error${g?.code ? ` (${g.code})` : ""}: ${msg}`,
        res.status >= 500 || res.status === 429,
        body,
      );
    }
    return body;
  }

  async send(creds: WhatsAppCredentials, to: string, message: OutboundMessage): Promise<SendResult> {
    const body = await this.request(creds, "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...toGraphMessage(message) }),
    });
    const id = (body.messages as { id?: string }[] | undefined)?.[0]?.id;
    if (!id) throw new WhatsAppError("WhatsApp API did not return a message ID", true, body);
    return { messageId: id };
  }

  async markAsRead(creds: WhatsAppCredentials, messageId: string): Promise<void> {
    await this.request(creds, "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
    });
  }

  /** Confirms the token can read this phone number (does not send a message). */
  async verifyPhoneNumber(creds: WhatsAppCredentials): Promise<{ id: string; displayPhoneNumber: string; verifiedName: string }> {
    const body = await this.request(creds, "?fields=id,display_phone_number,verified_name", { method: "GET" });
    return {
      id: String(body.id ?? creds.phoneNumberId),
      displayPhoneNumber: String(body.display_phone_number ?? ""),
      verifiedName: String(body.verified_name ?? ""),
    };
  }

  receiveMessage(payload: unknown): ParsedWebhook {
    return parseWhatsAppWebhook(payload);
  }

  /**
   * Upload a file once and return Meta's media id. Callers cache the id: it
   * keeps working when this app is not reachable from the public internet.
   */
  async uploadMedia(creds: WhatsAppCredentials, file: Buffer, mimeType: string, filename: string): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([new Uint8Array(file)], { type: mimeType }), filename);
    const body = await this.request(creds, "/media", { method: "POST", body: form });
    const id = String(body.id ?? "");
    if (!id) throw new WhatsAppError("WhatsApp API did not return a media id", true, body);
    return id;
  }
}

/**
 * Translate our message shape into the Graph API envelope, clamping every field
 * to the documented limit so an over-long item name cannot fail a send.
 */
export function toGraphMessage(message: OutboundMessage): Record<string, unknown> {
  if (message.kind === "text") {
    return { type: "text", text: { preview_url: false, body: clamp(message.text, WA_LIMITS.textBody) } };
  }

  if (message.kind === "image" || message.kind === "document") {
    const media = "mediaId" in message.media ? { id: message.media.mediaId } : { link: message.media.link };
    const caption = message.caption ? { caption: clamp(message.caption, 1024) } : {};
    if (message.kind === "image") return { type: "image", image: { ...media, ...caption } };
    return {
      type: "document",
      document: { ...media, filename: message.filename.slice(0, 240) || "menu.pdf", ...caption },
    };
  }

  const header = message.header ? { header: { type: "text", text: clamp(message.header, WA_LIMITS.headerText) } } : {};
  const footer = message.footer ? { footer: { text: clamp(message.footer, WA_LIMITS.footerText) } } : {};

  if (message.kind === "buttons") {
    const imageHeader = message.image
      ? {
          header: {
            type: "image",
            image: "mediaId" in message.image ? { id: message.image.mediaId } : { link: message.image.link },
          },
        }
      : header;
    return {
      type: "interactive",
      interactive: {
        type: "button",
        ...imageHeader,
        body: { text: clamp(message.body, WA_LIMITS.interactiveBody) },
        ...footer,
        action: {
          buttons: message.buttons.slice(0, WA_LIMITS.maxButtons).map((b) => ({
            type: "reply",
            reply: { id: b.id.slice(0, WA_LIMITS.replyId), title: clamp(b.title, WA_LIMITS.buttonTitle) },
          })),
        },
      },
    };
  }

  if (message.kind === "cta_url") {
    return {
      type: "interactive",
      interactive: {
        type: "cta_url",
        ...header,
        body: { text: clamp(message.body, WA_LIMITS.interactiveBody) },
        ...footer,
        action: {
          name: "cta_url",
          parameters: {
            display_text: clamp(message.buttonText, WA_LIMITS.ctaUrlButton),
            url: message.url.slice(0, 2000),
          },
        },
      },
    };
  }

  // A list message carries at most 10 rows in total, no matter how they are split.
  let budget = WA_LIMITS.maxListRows;
  const sections = [];
  for (const s of message.sections.slice(0, WA_LIMITS.maxListSections)) {
    if (budget <= 0) break;
    const rows = s.rows.slice(0, budget).map((r) => ({
      id: r.id.slice(0, WA_LIMITS.replyId),
      title: clamp(r.title, WA_LIMITS.rowTitle),
      ...(r.description ? { description: clamp(r.description, WA_LIMITS.rowDescription) } : {}),
    }));
    if (!rows.length) continue;
    budget -= rows.length;
    sections.push({ ...(s.title ? { title: clamp(s.title, WA_LIMITS.sectionTitle) } : {}), rows });
  }

  return {
    type: "interactive",
    interactive: {
      type: "list",
      ...header,
      body: { text: clamp(message.body, WA_LIMITS.interactiveBody) },
      ...footer,
      action: { button: clamp(message.buttonLabel, WA_LIMITS.listButtonLabel), sections },
    },
  };
}

/** Parse the Meta webhook envelope. Tolerant of unknown fields and types. */
export function parseWhatsAppWebhook(payload: unknown): ParsedWebhook {
  const out: ParsedWebhook = { messages: [], statuses: [] };
  const entries = (payload as WebhookPayload)?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (change.field && change.field !== "messages") continue;
      const value = change.value;
      if (!value) continue;
      const phoneNumberId = value.metadata?.phone_number_id ?? "";
      const displayPhoneNumber = value.metadata?.display_phone_number;
      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) if (c.wa_id && c.profile?.name) names.set(c.wa_id, c.profile.name);

      for (const m of value.messages ?? []) {
        const id = String(m.id ?? "");
        const from = String(m.from ?? "");
        if (!id || !from) continue;
        const type = String(m.type ?? "other");
        const ts = new Date(Number(m.timestamp ?? 0) * 1000 || Date.now());
        const msg: InboundMessage = {
          phoneNumberId,
          displayPhoneNumber,
          from,
          profileName: names.get(from),
          messageId: id,
          timestamp: ts,
          type: "other",
        };
        const asObj = (k: string) => m[k] as Record<string, unknown> | undefined;
        if (type === "text") {
          msg.type = "text";
          msg.text = String(asObj("text")?.body ?? "");
        } else if (type === "image" || type === "video" || type === "document" || type === "audio" || type === "sticker") {
          msg.type = type;
          const media = asObj(type);
          msg.mediaId = media?.id as string | undefined;
          msg.caption = media?.caption as string | undefined;
        } else if (type === "location") {
          msg.type = "location";
          const loc = asObj("location");
          const latitude = Number(loc?.latitude);
          const longitude = Number(loc?.longitude);
          const name = typeof loc?.name === "string" ? loc.name : undefined;
          const address = typeof loc?.address === "string" ? loc.address : undefined;
          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            msg.location = { latitude, longitude, name, address };
          }
          msg.text = [name, address].filter(Boolean).join(", ") || (msg.location ? `Pinned location (${latitude}, ${longitude})` : "");
        } else if (type === "button") {
          // Quick reply on a template message.
          msg.type = "button";
          const b = asObj("button");
          msg.text = String(b?.text ?? "");
          msg.interactiveId = b?.payload as string | undefined;
        } else if (type === "interactive") {
          msg.type = "interactive";
          const i = asObj("interactive");
          const reply = (i?.button_reply ?? i?.list_reply) as { id?: string; title?: string } | undefined;
          msg.text = String(reply?.title ?? "");
          msg.interactiveId = reply?.id;
        }
        out.messages.push(msg);
      }

      for (const s of value.statuses ?? []) {
        const status = String(s.status ?? "");
        if (!["sent", "delivered", "read", "failed"].includes(status)) continue;
        const errors = s.errors as { title?: string; message?: string; code?: number }[] | undefined;
        const st: StatusUpdate = {
          phoneNumberId,
          messageId: String(s.id ?? ""),
          status: status as StatusUpdate["status"],
          timestamp: new Date(Number(s.timestamp ?? 0) * 1000 || Date.now()),
          recipient: s.recipient_id as string | undefined,
          error: errors?.[0]
            ? `${errors[0].title ?? errors[0].message ?? "Delivery failed"}${errors[0].code ? ` (${errors[0].code})` : ""}`
            : undefined,
        };
        if (st.messageId) out.statuses.push(st);
      }
    }
  }
  return out;
}
