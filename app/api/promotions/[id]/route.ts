import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { readKitchenSession } from "@/lib/session";
import { endWebsitePromotion } from "@/services/promotions/end-website";

export const runtime = "nodejs";

async function authorisedStore() {
  const session = await readKitchenSession();
  if (!session) return null;
  return db.store.findUnique({ where: { id: session.storeId } });
}

/** Remove a website special immediately (kitchen PIN required). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const store = await authorisedStore();
  if (!store) return Response.json({ error: "Sign in" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id?.trim()) return Response.json({ error: "Missing promotion" }, { status: 400 });

  try {
    const result = await endWebsitePromotion(store.id, id.trim());
    return Response.json({
      ok: true,
      id: result.id,
      detail: result.alreadyEnded
        ? "That special was already off the website."
        : "Removed from the website specials page.",
    });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return Response.json({ error: "Promotion not found" }, { status: 404 });
    }
    const message = e instanceof Error ? e.message : "Could not remove that promotion.";
    return Response.json({ error: message }, { status: 400 });
  }
}
