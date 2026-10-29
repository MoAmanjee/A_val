import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { placeWebOrder } from "@/services/orders/web-checkout";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.number().int().min(1).max(50),
  isMeal: z.boolean().nullable().optional(),
  notes: z.string().max(240).optional(),
  modifiers: z
    .array(
      z.object({
        groupId: z.string().min(1),
        optionIds: z.array(z.string().min(1)).max(8),
      }),
    )
    .max(20),
});

const bodySchema = z.object({
  phone: z.string().min(8).max(20),
  name: z.string().trim().min(1, "Name is required").max(80),
  notes: z.string().max(500).optional(),
  fulfilment: z.enum(["COLLECTION", "DELIVERY"]).optional(),
  deliveryAddress: z.string().max(240).optional(),
  deliveryNotes: z.string().max(240).optional(),
  /** Stripe PaymentIntent id after Apple Pay / Samsung Pay / card succeeded. */
  paymentIntentId: z.string().min(3).max(120).optional(),
  /** Demo / no-Stripe path: mark paid online with this wallet label. */
  onlineWallet: z.enum(["apple_pay", "samsung_pay", "google_pay", "card"]).optional(),
  lines: z.array(lineSchema).min(1).max(40),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const input = bodySchema.parse(json);
    const order = await placeWebOrder(input);

    return NextResponse.json({
      ok: true,
      orderNumber: order.orderNumber,
      totalCents: order.totalCents,
      status: order.status,
      quotedPrepMinutes: order.quotedPrepMinutes,
      fulfilment: order.fulfilment,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      items: order.items.map((item) => ({
        name: item.nameSnapshot,
        quantity: item.quantity,
        isMeal: item.isMeal,
        lineTotalCents: item.lineTotalCents,
        modifiers: item.modifiers.map((m) => m.optionNameSnapshot),
        notes: item.notes,
      })),
      notes: order.notes,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid order payload", detail: error.flatten() }, { status: 400 });
    }
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("web place order failed", error);
    return NextResponse.json({ error: "Could not place the order" }, { status: 500 });
  }
}
