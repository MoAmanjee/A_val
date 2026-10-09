import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MenuImage, Store } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendToCustomer } from "@/services/conversations";
import { CloudApiWhatsAppService, getCredentials, getWhatsAppService, type MediaRef } from "@/services/whatsapp";

/** Meta media ids are refreshed before they age out (about 30 days). */
const MEDIA_MAX_AGE_MS = 25 * 24 * 60 * 60 * 1000;

function publicFile(filePath: string): string {
  return path.join(process.cwd(), "public", filePath);
}

function publicLink(filePath: string): string {
  return `${env.appUrl.replace(/\/$/, "")}/${filePath.replace(/^\//, "")}`;
}

/**
 * Prefer a cached Meta media id. Upload from disk when the Cloud API is
 * configured, and fall back to a public link the customer can open.
 */
export async function resolveMenuMedia(store: Store, image: MenuImage): Promise<MediaRef | null> {
  const fresh =
    image.whatsappMediaId &&
    image.mediaUploadedAt &&
    Date.now() - image.mediaUploadedAt.getTime() < MEDIA_MAX_AGE_MS;
  if (fresh && image.whatsappMediaId) return { mediaId: image.whatsappMediaId };

  const service = getWhatsAppService();
  if (service instanceof CloudApiWhatsAppService) {
    try {
      const bytes = await readFile(publicFile(image.filePath));
      const mediaId = await service.uploadMedia(getCredentials(store), bytes, image.mimeType, path.basename(image.filePath));
      await db.menuImage.update({
        where: { id: image.id },
        data: { whatsappMediaId: mediaId, mediaUploadedAt: new Date() },
      });
      return { mediaId };
    } catch (e) {
      console.warn("[menu] could not upload menu media, sending a link instead", e);
    }
  }

  try {
    await readFile(publicFile(image.filePath));
  } catch {
    return null;
  }
  return { link: publicLink(image.filePath) };
}

const MENU_REPEAT_WINDOW_MS = 30 * 60 * 1000;

/**
 * Whether this start should include the printed pages.
 * Saying hi twice before ordering does not send them again. Placing an order
 * and coming back does, even inside that half hour.
 */
export function menuPicturesDue(input: {
  force?: boolean;
  lastSentAt: Date | null;
  lastConfirmedAt: Date | null;
  now?: Date;
}): boolean {
  if (input.force) return true;
  if (!input.lastSentAt) return true;
  const now = input.now ?? new Date();
  const recent = now.getTime() - input.lastSentAt.getTime() < MENU_REPEAT_WINDOW_MS;
  if (!recent) return true;
  return Boolean(input.lastConfirmedAt && input.lastConfirmedAt > input.lastSentAt);
}

/**
 * Send the printed menu. Pictures go at the start of an order; the PDF
 * only when the customer asked for a file, so a greeting does not dump a document.
 * Returns how many messages were handed to WhatsApp.
 */
export async function sendMenuPictures(
  conversationId: string,
  opts: { includePdf?: boolean; force?: boolean; newOrder?: boolean } = {},
): Promise<number> {
  if (!opts.force) {
    const since = new Date(Date.now() - MENU_REPEAT_WINDOW_MS);
    const recent = await db.message.findFirst({
      where: {
        conversationId,
        direction: "OUTBOUND",
        messageType: { in: ["IMAGE", "DOCUMENT"] },
        deliveryStatus: { not: "FAILED" },
        createdAt: { gt: since },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    let lastConfirmedAt: Date | null = null;
    if (recent && opts.newOrder) {
      const placed = await db.order.findFirst({
        where: { conversationId, confirmedAt: { not: null } },
        orderBy: { confirmedAt: "desc" },
        select: { confirmedAt: true },
      });
      lastConfirmedAt = placed?.confirmedAt ?? null;
    }
    if (!menuPicturesDue({ force: false, lastSentAt: recent?.createdAt ?? null, lastConfirmedAt })) return 0;
  }

  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { store: true } });
  const images = await db.menuImage.findMany({
    where: { storeId: conv.storeId, active: true, ...(opts.includePdf ? {} : { isDocument: false }) },
    orderBy: { sortOrder: "asc" },
  });

  let sent = 0;
  for (const image of images) {
    const media = await resolveMenuMedia(conv.store, image);
    if (!media) continue;
    const result = image.isDocument
      ? await sendToCustomer(
          conversationId,
          {
            kind: "document",
            media,
            filename: image.fileName || "Mochachos-Menu.pdf",
            caption: image.caption ?? undefined,
          },
          "AI",
        )
      : await sendToCustomer(conversationId, { kind: "image", media, caption: image.caption ?? undefined }, "AI");
    if (result.sent) sent += 1;
  }
  return sent;
}
