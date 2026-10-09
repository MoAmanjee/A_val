import { parseWhatsAppWebhook } from "@/services/whatsapp/cloud";
import {
  WhatsAppError,
  type OutboundMessage,
  type ParsedWebhook,
  type SendResult,
  type WhatsAppCredentials,
  type WhatsAppService,
} from "@/services/whatsapp/types";

export interface MockOutbound {
  to: string;
  message: OutboundMessage;
  messageId: string;
  phoneNumberId: string;
}

/**
 * In-memory driver for local development and tests (WHATSAPP_DRIVER=mock).
 * It records every outbound message and can be told to fail the next send.
 */
export class MockWhatsAppService implements WhatsAppService {
  readonly name = "mock";
  readonly outbox: MockOutbound[] = [];
  readonly read: string[] = [];
  failNext: WhatsAppError | null = null;
  private counter = 0;

  async send(creds: WhatsAppCredentials, to: string, message: OutboundMessage): Promise<SendResult> {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.counter += 1;
    const messageId = `wamid.MOCK${Date.now()}${this.counter}`;
    this.outbox.push({ to, message, messageId, phoneNumberId: creds.phoneNumberId });
    return { messageId };
  }

  async markAsRead(_creds: WhatsAppCredentials, messageId: string): Promise<void> {
    this.read.push(messageId);
  }

  receiveMessage(payload: unknown): ParsedWebhook {
    return parseWhatsAppWebhook(payload);
  }

  /** Every reply id offered to the customer in the most recent message. */
  lastReplyIds(): string[] {
    const last = this.outbox.at(-1)?.message;
    if (!last) return [];
    if (last.kind === "buttons") return last.buttons.map((b) => b.id);
    if (last.kind === "list") return last.sections.flatMap((s) => s.rows.map((r) => r.id));
    return [];
  }

  /** Flattened text of every outbound message, for assertions. */
  texts(): string[] {
    return this.outbox.map((o) => {
      const message = o.message;
      if (message.kind === "text") return message.text;
      if (message.kind === "image") return message.caption ?? "";
      if (message.kind === "document") return message.caption ?? message.filename;
      return message.body;
    });
  }

  reset() {
    this.outbox.length = 0;
    this.read.length = 0;
    this.failNext = null;
    this.counter = 0;
  }
}
