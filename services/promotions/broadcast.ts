import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Store } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendToCustomer } from "@/services/conversations";
import { CloudApiWhatsAppService, getCredentials, getWhatsAppService, type MediaRef, type OutboundMessage } from "@/services/whatsapp";

/** WhatsApp only allows a free-form picture or text inside this window. */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

const PLACEHOLDER_PHONE_ID = "100000000000001";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 1000;

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type RecipientWindow = "open" | "closed" | "unknown";

export function classifyRecipient(lastInboundAt: Date | null, now: Date): RecipientWindow {
  if (!lastInboundAt) return "unknown";
  return now.getTime() - lastInboundAt.getTime() < SESSION_WINDOW_MS ? "open" : "closed";
}

export function promotionOutbound(input: { text: string | null; media: MediaRef | null }): OutboundMessage {
  const text = input.text?.trim() || null;
  if (input.media && text) return { kind: "image", media: input.media, caption: text };
  if (input.media) return { kind: "image", media: input.media };
  if (text) return { kind: "text", text };
  throw new Error("Add a picture, some text, or both.");
}

export interface WhatsAppStatus {
  live: boolean;
  detail: string;
}

export function describeWhatsApp(store: Pick<Store, "whatsappPhoneNumberId" | "whatsappAccessTokenEnc"> | null): WhatsAppStatus {
  const phoneId = store?.whatsappPhoneNumberId || env.whatsappPhoneNumberId;
  const mock = env.whatsappDriver !== "cloud";
  const placeholder = !phoneId || phoneId === PLACEHOLDER_PHONE_ID;
  const token = Boolean(env.whatsappAccessToken || store?.whatsappAccessTokenEnc);
  if (mock) {
    return {
      live: false,
      detail: "WhatsApp is not live. This server is in test mode, so messages stay here and do not arrive on phones.",
    };
  }
  if (placeholder) {
    return {
      live: false,
      detail: "WhatsApp is not live. The shop number is not connected yet. Set the phone number id on the store, then send again.",
    };
  }
  if (!token) {
    return {
      live: false,
      detail: "WhatsApp is not live. The access token is missing, so nothing can be delivered to phones.",
    };
  }
  return {
    live: true,
    detail: "WhatsApp is live. A promotion goes to customers who messaged in the last 24 hours.",
  };
}

export interface AudienceCounts {
  messaged: number;
  insideWindow: number;
}

export async function promotionAudience(storeId: string, now = new Date()): Promise<AudienceCounts> {
  const rows = await loadRecipients(storeId);
  return {
    messaged: rows.length,
    insideWindow: rows.filter((row) => classifyRecipient(row.lastInboundAt, now) === "open").length,
  };
}

export interface PromotionInput {
  storeId: string;
  text: string | null;
  image: { bytes: Buffer; mimeType: string } | null;
}

export interface PromotionResult {
  id: string;
  reachedPhones: boolean;
  sent: number;
  skipped: number;
  failed: number;
  detail: string;
}

export async function sendPromotion(input: PromotionInput, now = new Date()): Promise<PromotionResult> {
  const text = input.text?.trim() || null;
  if (text && text.length > MAX_TEXT) throw new Error(`Keep the text under ${MAX_TEXT} characters.`);
  if (!text && !input.image) throw new Error("Add a picture, some text, or both.");
  if (input.image) {
    if (!IMAGE_TYPES[input.image.mimeType]) throw new Error("Use a JPEG, PNG, or WebP picture.");
    if (input.image.bytes.length > MAX_IMAGE_BYTES) throw new Error("That picture is over 5 MB. Use a smaller one.");
    if (input.image.bytes.length < 32) throw new Error("That picture looks empty.");
  }

  const store = await db.store.findUniqueOrThrow({ where: { id: input.storeId } });
  const status = describeWhatsApp(store);
  const promotion = await db.promotion.create({
    data: { storeId: store.id, body: text },
  });

  let imagePath: string | null = null;
  if (input.image) {
    const ext = IMAGE_TYPES[input.image.mimeType];
    imagePath = `promotions/${promotion.id}.${ext}`;
    const disk = path.join(process.cwd(), "public", imagePath);
    await mkdir(path.dirname(disk), { recursive: true });
    await writeFile(disk, input.image.bytes);
    await db.promotion.update({ where: { id: promotion.id }, data: { imagePath } });
  }

  const recipients = await loadRecipients(store.id);
  if (!status.live) {
    if (recipients.length) {
      await db.promotionDelivery.createMany({
        data: recipients.map((row) => ({
          promotionId: promotion.id,
          customerId: row.customerId,
          status: "SKIPPED" as const,
          detail: "WhatsApp is not connected, so this was not sent to the phone.",
        })),
      });
    }
    return {
      id: promotion.id,
      reachedPhones: false,
      sent: 0,
      skipped: recipients.length,
      failed: 0,
      detail: `${status.detail} ${recipients.length} ${recipients.length === 1 ? "person was" : "people were"} not sent.`,
    };
  }

  const media = input.image && imagePath ? await resolvePromotionMedia(store, input.image, imagePath) : null;
  const message = promotionOutbound({ text, media });
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of recipients) {
    const window = classifyRecipient(row.lastInboundAt, now);
    if (window !== "open") {
      skipped += 1;
      await db.promotionDelivery.create({
        data: {
          promotionId: promotion.id,
          customerId: row.customerId,
          status: "SKIPPED",
          detail:
            window === "closed"
              ? "Their last message was more than 24 hours ago. WhatsApp blocks a free-form promotion after that."
              : "There is no incoming message time for this customer.",
        },
      });
      continue;
    }
    const result = await sendToCustomer(row.conversationId, message, "STAFF");
    if (result.sent) {
      sent += 1;
      await db.promotionDelivery.create({
        data: { promotionId: promotion.id, customerId: row.customerId, status: "SENT" },
      });
    } else {
      failed += 1;
      await db.promotionDelivery.create({
        data: {
          promotionId: promotion.id,
          customerId: row.customerId,
          status: "FAILED",
          detail: result.error ?? "WhatsApp did not accept the message.",
        },
      });
    }
  }

  return {
    id: promotion.id,
    reachedPhones: true,
    sent,
    skipped,
    failed,
    detail:
      sent > 0
        ? `Sent to ${sent} ${sent === 1 ? "customer" : "customers"} who messaged in the last 24 hours.`
        : "Nobody was inside WhatsApp's 24-hour window, so no phone received it.",
  };
}

async function loadRecipients(storeId: string): Promise<{ customerId: string; conversationId: string; lastInboundAt: Date | null }[]> {
  const conversations = await db.conversation.findMany({
    where: { storeId },
    select: { id: true, customerId: true, lastInboundAt: true },
    orderBy: { lastInboundAt: "desc" },
  });
  const seen = new Set<string>();
  const rows: { customerId: string; conversationId: string; lastInboundAt: Date | null }[] = [];
  for (const conversation of conversations) {
    if (seen.has(conversation.customerId)) continue;
    seen.add(conversation.customerId);
    rows.push({
      customerId: conversation.customerId,
      conversationId: conversation.id,
      lastInboundAt: conversation.lastInboundAt,
    });
  }
  return rows;
}

async function resolvePromotionMedia(
  store: Store,
  image: { bytes: Buffer; mimeType: string },
  imagePath: string,
): Promise<MediaRef> {
  const service = getWhatsAppService();
  if (service instanceof CloudApiWhatsAppService) {
    const filename = path.basename(imagePath);
    const mediaId = await service.uploadMedia(getCredentials(store), image.bytes, image.mimeType, filename);
    return { mediaId };
  }
  return { link: `${env.appUrl.replace(/\/$/, "")}/${imagePath}` };
}
