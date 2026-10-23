import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { duplicateQuotation } from "@/services/quotes/service";

export const POST = route<{ id: string }>(async ({ session, params }) => {
  return NextResponse.json({ quotation: await duplicateQuotation(session.actor, params.id) }, { status: 201 });
});
