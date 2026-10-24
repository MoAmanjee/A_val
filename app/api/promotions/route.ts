import { db } from "@/lib/db";
import { readKitchenSession } from "@/lib/session";
import { describeWhatsApp, parsePromoPrice, promotionAudience, sendPromotion } from "@/services/promotions/broadcast";

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

  return Response.json({
    whatsapp: describeWhatsApp(store),
    audience,
  });
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
    const result = await sendPromotion({ storeId: store.id, text, image, priceCents });
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not send that promotion.";
    return Response.json({ error: message }, { status: 400 });
  }
}
