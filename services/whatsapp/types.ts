export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export interface SendResult {
  messageId: string;
}

export interface ReplyButton {
  /** Our own routing id, echoed back when the customer taps it. */
  id: string;
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title?: string;
  rows: ListRow[];
}

/**
 * Media is addressed either by a Meta media id (uploaded once, then reused) or
 * by a public URL. Ids are preferred: they keep working whether or not this app
 * is reachable from the internet.
 */
export type MediaRef = { mediaId: string } | { link: string };

/**
 * What the bot can put on the screen. Buttons and lists matter here: a tapped
 * reply comes back with the exact id we sent, so choosing a flavour or
 * confirming an order never depends on parsing free text.
 */
export type OutboundMessage =
  | { kind: "text"; text: string }
  | { kind: "buttons"; body: string; buttons: ReplyButton[]; header?: string; footer?: string; image?: MediaRef }
  | { kind: "list"; body: string; buttonLabel: string; sections: ListSection[]; header?: string; footer?: string }
  | { kind: "image"; media: MediaRef; caption?: string }
  | { kind: "document"; media: MediaRef; filename: string; caption?: string };

export interface InboundMessage {
  /** Meta phone_number_id the message was sent to: identifies the store. */
  phoneNumberId: string;
  displayPhoneNumber?: string;
  from: string;
  profileName?: string;
  messageId: string;
  timestamp: Date;
  type: "text" | "image" | "audio" | "document" | "location" | "video" | "sticker" | "button" | "interactive" | "other";
  text?: string;
  /** The id of the button or list row the customer tapped, when there is one. */
  interactiveId?: string;
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
  send(creds: WhatsAppCredentials, to: string, message: OutboundMessage): Promise<SendResult>;
  markAsRead(creds: WhatsAppCredentials, messageId: string): Promise<void>;
  /** Parse a raw webhook payload into normalised inbound messages and statuses. */
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
