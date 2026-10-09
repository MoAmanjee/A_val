import { db } from "@/lib/db";
import { AppError, errorMessage } from "@/lib/errors";
import { readKitchenSession } from "@/lib/session";
import { acknowledgeOrder, cancelOrder, markCollected, markPreparing, markReady } from "@/services/orders/lifecycle";

const ACTIONS = ["acknowledge", "preparing", "ready", "collected", "reject"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await readKitchenSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });

  const { id } = await context.params;
  const order = await db.order.findFirst({ where: { id, storeId: session.storeId }, select: { id: true } });
  if (!order) return Response.json({ error: "That order is not on this screen." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { action?: unknown; prepMinutes?: unknown; reason?: unknown } | null;
  const action = body?.action;
  if (!ACTIONS.includes(action as Action)) {
    return Response.json({ error: "Unknown kitchen action." }, { status: 400 });
  }

  const prepMinutes = typeof body?.prepMinutes === "number" ? body.prepMinutes : undefined;
  const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "Kitchen could not make this order";

  try {
    if (action === "acknowledge") await acknowledgeOrder(id, { by: "kitchen", prepMinutes });
    else if (action === "preparing") await markPreparing(id, "kitchen");
    else if (action === "ready") await markReady(id, "kitchen");
    else if (action === "collected") await markCollected(id, "kitchen");
    else await cancelOrder(id, { by: "KITCHEN", reason, actor: "kitchen" });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 400;
    return Response.json({ error: errorMessage(e) }, { status });
  }

  return Response.json({ ok: true });
}
