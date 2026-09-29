import { env } from "@/lib/env";
import {
  WhatsAppError,
  type InboundMessage,
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
      throw new WhatsAppError(`WhatsApp API error${g?.code ? ` (${g.code})` : ""}: ${msg}`, res.status >= 500 || res.status === 429, body);
    }
    return body;
  }

  private extractId(body: Record<string, unknown>): string {
    const id = (body.messages as { id?: string }[] | undefined)?.[0]?.id;
    if (!id) throw new WhatsAppError("WhatsApp API did not return a message ID", true, body);
    return id;
  }

  async sendMessage(creds: WhatsAppCredentials, input: { to: string; text: string }): Promise<SendResult> {
    const body = await this.request(creds, "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "text",
        text: { preview_url: false, body: input.text.slice(0, 4096) },
      }),
    });
    return { messageId: this.extractId(body) };
  }

  async sendDocument(
    creds: WhatsAppCredentials,
    input: { to: string; document: Buffer; filename: string; mimeType?: string; caption?: string },
  ): Promise<SendResult> {
    // Upload the media first so we do not need a publicly reachable PDF URL.
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", input.mimeType ?? "application/pdf");
    form.append(
      "file",
      new Blob([new Uint8Array(input.document)], { type: input.mimeType ?? "application/pdf" }),
      input.filename,
    );
    const media = await this.request(creds, "/media", { method: "POST", body: form });
    const mediaId = media.id as string | undefined;
    if (!mediaId) throw new WhatsAppError("WhatsApp media upload did not return an ID", true, media);

    const body = await this.request(creds, "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "document",
        document: { id: mediaId, filename: input.filename, caption: input.caption?.slice(0, 1024) },
      }),
    });
    return { messageId: this.extractId(body) };
  }

  async markAsRead(creds: WhatsAppCredentials, messageId: string): Promise<void> {
    await this.request(creds, "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
    });
  }

  receiveMessage(payload: unknown): ParsedWebhook {
    return parseWhatsAppWebhook(payload);
  }
}

/** Parse the Meta webhook envelope. Tolerant of unknown fields/types. */
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
          msg.text = `Shared location: ${loc?.latitude}, ${loc?.longitude}`;
        } else if (type === "button") {
          msg.type = "button";
          msg.text = String(asObj("button")?.text ?? "");
        } else if (type === "interactive") {
          msg.type = "interactive";
          const i = asObj("interactive");
          msg.text = String((i?.button_reply as { title?: string })?.title ?? (i?.list_reply as { title?: string })?.title ?? "");
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
          error: errors?.[0] ? `${errors[0].title ?? errors[0].message ?? "Delivery failed"}${errors[0].code ? ` (${errors[0].code})` : ""}` : undefined,
        };
        if (st.messageId) out.statuses.push(st);
      }
    }
  }
  return out;
}
