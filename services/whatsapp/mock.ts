import { parseWhatsAppWebhook } from "@/services/whatsapp/cloud";
import {
  WhatsAppError,
  type ParsedWebhook,
  type SendResult,
  type WhatsAppCredentials,
  type WhatsAppService,
} from "@/services/whatsapp/types";

export interface MockOutbound {
  kind: "text" | "document";
  to: string;
  text?: string;
  caption?: string;
  filename?: string;
  documentBytes?: number;
  document?: Buffer;
  messageId: string;
  phoneNumberId: string;
}

/**
 * In-memory driver for local development and tests (WHATSAPP_DRIVER=mock).
 * It records every outbound message and can be told to fail.
 */
export class MockWhatsAppService implements WhatsAppService {
  readonly name = "mock";
  readonly outbox: MockOutbound[] = [];
  readonly read: string[] = [];
  failNext: WhatsAppError | null = null;
  private counter = 0;

  private nextId() {
    this.counter += 1;
    return `wamid.MOCK${Date.now()}${this.counter}`;
  }

  private maybeFail() {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }

  async sendMessage(creds: WhatsAppCredentials, input: { to: string; text: string }): Promise<SendResult> {
    this.maybeFail();
    const messageId = this.nextId();
    this.outbox.push({ kind: "text", to: input.to, text: input.text, messageId, phoneNumberId: creds.phoneNumberId });
    return { messageId };
  }

  async sendDocument(
    creds: WhatsAppCredentials,
    input: { to: string; document: Buffer; filename: string; caption?: string },
  ): Promise<SendResult> {
    this.maybeFail();
    const messageId = this.nextId();
    this.outbox.push({
      kind: "document",
      to: input.to,
      caption: input.caption,
      filename: input.filename,
      documentBytes: input.document.length,
      document: input.document,
      messageId,
      phoneNumberId: creds.phoneNumberId,
    });
    return { messageId };
  }

  async markAsRead(_creds: WhatsAppCredentials, messageId: string): Promise<void> {
    this.read.push(messageId);
  }

  receiveMessage(payload: unknown): ParsedWebhook {
    return parseWhatsAppWebhook(payload);
  }

  reset() {
    this.outbox.length = 0;
    this.read.length = 0;
    this.failNext = null;
  }
}
