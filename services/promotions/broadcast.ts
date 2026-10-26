import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PromotionScheduleKind, Store } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendToCustomer } from "@/services/conversations";
import { encodeReplyId } from "@/services/messaging/reply-ids";
import { CloudApiWhatsAppService, getCredentials, getWhatsAppService, type MediaRef, type OutboundMessage } from "@/services/whatsapp";
import { formatCents, parsePriceToCents } from "@/utils/money";

/** Promotion broadcasts go to customers who messaged within the last month. */
export const SESSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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

/** A special the customer can tap stays under R2000. */
export const PROMO_PRICE_MAX_CENTS = 200_000;

const PROMO_CATEGORY = "Promotions";

/** Blank means this is an announcement. A number means they can order it. */
export function parsePromoPrice(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const cents = parsePriceToCents(raw);
  if (cents < 0) throw new Error("The price cannot be negative.");
  if (cents > PROMO_PRICE_MAX_CENTS) throw new Error("Keep the promotion price at R2000 or less.");
  return cents;
}

/** First line of the note, used as the kitchen ticket name. */
export function promoItemName(text: string | null): string {
  const line = (text ?? "").split(/\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  const cleaned = line.replace(/[^\p{L}\p{N}&'.,\- ]/gu, "").trim();
  return (cleaned || "Today's special").slice(0, 80);
}

export function promotionOutbound(input: {
  text: string | null;
  media: MediaRef | null;
  priceCents?: number | null;
  menuItemId?: string | null;
  currencySymbol?: string;
}): OutboundMessage {
  const text = input.text?.trim() || null;
  if (input.priceCents != null && input.menuItemId) {
    const price = input.priceCents === 0 ? "Free" : formatCents(input.priceCents, input.currencySymbol ?? "R");
    const words = text || promoItemName(text);
    return {
      kind: "buttons",
      image: input.media ?? undefined,
      body: `${words}\n\n*${price}*\n\nTap Order this and I'll add it. You can add other items, then collect or get it delivered.`,
      buttons: [
        { id: encodeReplyId({ kind: "item", menuItemId: input.menuItemId }), title: "Order this" },
        { id: encodeReplyId({ kind: "categories" }), title: "Browse the menu" },
        { id: encodeReplyId({ kind: "typeOrder" }), title: "Type order" },
      ],
    };
  }
  if (input.media && text) return { kind: "image", media: input.media, caption: text };
  if (input.media) return { kind: "image", media: input.media };
  if (text) return { kind: "text", text };
  throw new Error("Add a picture, some text, or a price.");
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
    detail: "WhatsApp is live. A promotion goes to customers who messaged in the last month.",
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

export interface PromotionWebsiteOptions {
  showOnWebsite: boolean;
  scheduleKind?: PromotionScheduleKind | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface PromotionInput {
  storeId: string;
  text: string | null;
  image: { bytes: Buffer; mimeType: string } | null;
  priceCents?: number | null;
  website?: PromotionWebsiteOptions | null;
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
  const priceCents = input.priceCents ?? null;
  if (text && text.length > MAX_TEXT) throw new Error(`Keep the text under ${MAX_TEXT} characters.`);
  if (!text && !input.image && priceCents == null) throw new Error("Add a picture, some text, or a price.");
  if (input.image) {
    if (!IMAGE_TYPES[input.image.mimeType]) throw new Error("Use a JPEG, PNG, or WebP picture.");
    if (input.image.bytes.length > MAX_IMAGE_BYTES) throw new Error("That picture is over 5 MB. Use a smaller one.");
    if (input.image.bytes.length < 32) throw new Error("That picture looks empty.");
  }

  const website = input.website;
  if (website?.showOnWebsite) {
    if (!website.scheduleKind || !website.startsAt || !website.endsAt) {
      throw new Error("Choose how long this promotion stays on the website.");
    }
    if (website.endsAt.getTime() <= website.startsAt.getTime()) {
      throw new Error("The website end time must be after the start time.");
    }
  }

  const store = await db.store.findUniqueOrThrow({ where: { id: input.storeId } });
  const status = describeWhatsApp(store);
  const promotion = await db.promotion.create({
    data: {
      storeId: store.id,
      body: text,
      priceCents,
      showOnWebsite: Boolean(website?.showOnWebsite),
      scheduleKind: website?.showOnWebsite ? website.scheduleKind ?? null : null,
      startsAt: website?.showOnWebsite ? website.startsAt ?? null : null,
      endsAt: website?.showOnWebsite ? website.endsAt ?? null : null,
    },
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

  let menuItemId: string | null = null;
  if (priceCents != null) {
    menuItemId = await createPromoItem(store.id, promoItemName(text), priceCents);
    await db.promotion.update({ where: { id: promotion.id }, data: { menuItemId } });
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
      detail: websiteDetail(
        `${status.detail} ${recipients.length} ${recipients.length === 1 ? "person was" : "people were"} not sent.`,
        Boolean(website?.showOnWebsite),
      ),
    };
  }

  const media = input.image && imagePath ? await resolvePromotionMedia(store, input.image, imagePath) : null;
  const message = promotionOutbound({ text, media, priceCents, menuItemId, currencySymbol: store.currencySymbol });
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
              ? "Their last message was more than a month ago, so they were skipped."
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

  const waDetail =
    sent > 0
      ? `Sent to ${sent} ${sent === 1 ? "customer" : "customers"} who messaged in the last month.`
      : "Nobody messaged in the last month, so no phone received it.";

  return {
    id: promotion.id,
    reachedPhones: true,
    sent,
    skipped,
    failed,
    detail: websiteDetail(waDetail, Boolean(website?.showOnWebsite)),
  };
}

function websiteDetail(whatsappDetail: string, onWebsite: boolean): string {
  if (!onWebsite) return whatsappDetail;
  return `${whatsappDetail} It is also live on the website specials page for the schedule you chose.`;
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

async function createPromoItem(storeId: string, name: string, priceCents: number): Promise<string> {
  let category = await db.menuCategory.findFirst({ where: { storeId, name: PROMO_CATEGORY } });
  if (!category) {
    category = await db.menuCategory.create({
      data: {
        storeId,
        name: PROMO_CATEGORY,
        description: "Specials sent on WhatsApp. Hidden from the regular menu.",
        active: false,
        sortOrder: 999,
      },
    });
  } else if (category.active) {
    category = await db.menuCategory.update({ where: { id: category.id }, data: { active: false } });
  }

  const item = await db.menuItem.create({
    data: {
      storeId,
      categoryId: category.id,
      name: await unusedItemName(storeId, name),
      priceCents,
      available: true,
      active: true,
    },
  });
  return item.id;
}

async function unusedItemName(storeId: string, name: string): Promise<string> {
  const taken = async (candidate: string) =>
    Boolean(await db.menuItem.findFirst({ where: { storeId, name: candidate }, select: { id: true } }));
  if (!(await taken(name))) return name;
  for (let n = 2; n < 50; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${name.slice(0, 80 - suffix.length)}${suffix}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${name.slice(0, 60)} ${Date.now().toString().slice(-6)}`;
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
