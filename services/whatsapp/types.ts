export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export interface SendResult {
  messageId: string;
}

export interface InboundMessage {
  /** Meta phone_number_id the message was sent to: identifies the business. */
  phoneNumberId: string;
  displayPhoneNumber?: string;
  from: string;
  profileName?: string;
  messageId: string;
  timestamp: Date;
  type: "text" | "image" | "audio" | "document" | "location" | "video" | "sticker" | "button" | "interactive" | "other";
  text?: string;
  mediaId?: string;
  caption?: string;
}

export interface StatusUpdate {
  phoneNumberId: string;
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: Date;
  recipient?: string;
  error?: string;
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
}

/**
 * Provider-agnostic WhatsApp integration. The first implementation targets the
 * official WhatsApp Business Cloud API; other providers (Twilio, 360dialog...)
 * can be added by implementing this interface.
 */
export interface WhatsAppService {
  readonly name: string;
  sendMessage(creds: WhatsAppCredentials, input: { to: string; text: string }): Promise<SendResult>;
  sendDocument(
    creds: WhatsAppCredentials,
    input: { to: string; document: Buffer; filename: string; mimeType?: string; caption?: string },
  ): Promise<SendResult>;
  markAsRead(creds: WhatsAppCredentials, messageId: string): Promise<void>;
  /** Parse a raw webhook payload into normalised inbound messages and delivery statuses. */
  receiveMessage(payload: unknown): ParsedWebhook;
}

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WhatsAppError";
  }
}
