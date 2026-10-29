import { db } from "@/lib/db";
import { readKitchenSession } from "@/lib/session";
import { describeWhatsApp, parsePromoPrice, promotionAudience, sendPromotion } from "@/services/promotions/broadcast";
import {
  activeWebsitePromoWhere,
  formatScheduleLabel,
  johannesburgDateKey,
  resolveWebsiteSchedule,
  type WebsiteScheduleInput,
} from "@/services/promotions/schedule";

export const runtime = "nodejs";

async function authorisedStore() {
  const session = await readKitchenSession();
  if (!session) return null;
  const store = await db.store.findUnique({ where: { id: session.storeId } });
  return store;
}

export async function GET() {
  const store = await authorisedStore();
  if (!store) return Response.json({ error: "Sign in" }, { status: 401 });

  const audience = await promotionAudience(store.id);
  const now = new Date();
  const websitePromos = await db.promotion.findMany({
    where: { storeId: store.id, showOnWebsite: true },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true,
      body: true,
      imagePath: true,
      priceCents: true,
      scheduleKind: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
    },
  });

  return Response.json({
    whatsapp: describeWhatsApp(store),
    audience,
    today: johannesburgDateKey(now),
    website: websitePromos.map((promo) => {
      const active =
        promo.startsAt != null &&
        promo.endsAt != null &&
        promo.startsAt.getTime() <= now.getTime() &&
        promo.endsAt.getTime() > now.getTime();
      return {
        id: promo.id,
        body: promo.body,
        imagePath: promo.imagePath,
        priceCents: promo.priceCents,
        scheduleKind: promo.scheduleKind,
        startsAt: promo.startsAt?.toISOString() ?? null,
        endsAt: promo.endsAt?.toISOString() ?? null,
        active,
        scheduleLabel: formatScheduleLabel(promo.scheduleKind, promo.startsAt, promo.endsAt),
      };
    }),
    activeOnWebsite: await db.promotion.count({
      where: { storeId: store.id, ...activeWebsitePromoWhere(now) },
    }),
  });
}

function parseWebsiteFromForm(form: FormData): WebsiteScheduleInput | null {
  const showRaw = form.get("showOnWebsite");
  const show =
    showRaw === "1" ||
    showRaw === "true" ||
    showRaw === "on" ||
    showRaw === "yes";
  if (!show) return null;

  const kindRaw = typeof form.get("scheduleKind") === "string" ? String(form.get("scheduleKind")) : "";
  const kind = kindRaw.trim().toUpperCase();
  if (kind === "DAILY") {
    const date = typeof form.get("scheduleDate") === "string" ? String(form.get("scheduleDate")) : "";
    return { kind: "DAILY", date: date || johannesburgDateKey() };
  }
  if (kind === "WEEKLY") {
    const weekOf = typeof form.get("scheduleWeekOf") === "string" ? String(form.get("scheduleWeekOf")) : "";
    return { kind: "WEEKLY", weekOf: weekOf || johannesburgDateKey() };
  }
  if (kind === "CUSTOM") {
    const startsAt = typeof form.get("scheduleStartsAt") === "string" ? String(form.get("scheduleStartsAt")) : "";
    const endsAt = typeof form.get("scheduleEndsAt") === "string" ? String(form.get("scheduleEndsAt")) : "";
    return { kind: "CUSTOM", startsAt, endsAt };
  }
  throw new Error("Choose One day, One week, or custom dates for the website.");
}

export async function POST(req: Request) {
  const store = await authorisedStore();
  if (!store) return Response.json({ error: "Sign in" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "Send a picture, some text, or both." }, { status: 400 });

  const textValue = form.get("text");
  const text = typeof textValue === "string" ? textValue : null;
  const priceValue = form.get("price");
  let priceCents: number | null = null;
  try {
    priceCents = parsePromoPrice(typeof priceValue === "string" ? priceValue : null);
  } catch (e) {
    const message = e instanceof Error ? e.message : "That price is not valid.";
    return Response.json({ error: message }, { status: 400 });
  }
  const file = form.get("image");
  let image: { bytes: Buffer; mimeType: string } | null = null;
  if (file instanceof File && file.size > 0) {
    image = { bytes: Buffer.from(await file.arrayBuffer()), mimeType: file.type || "application/octet-stream" };
  }

  try {
    const scheduleInput = parseWebsiteFromForm(form);
    const window = scheduleInput ? resolveWebsiteSchedule(scheduleInput) : null;
    const result = await sendPromotion({
      storeId: store.id,
      text,
      image,
      priceCents,
      website: window
        ? {
            showOnWebsite: true,
            scheduleKind: window.scheduleKind,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
          }
        : { showOnWebsite: false },
    });
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not send that promotion.";
    return Response.json({ error: message }, { status: 400 });
  }
}
