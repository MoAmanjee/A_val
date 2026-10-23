import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { getOrCreateDraftForConversation } from "@/services/quotes/service";

/** "Create Quote" button: returns the existing open quote for the conversation or creates a draft. */
export const POST = route<{ id: string }>(async ({ session, params }) => {
  const { quotation, created } = await getOrCreateDraftForConversation(session.actor, params.id);
  return NextResponse.json({ quotation, created }, { status: created ? 201 : 200 });
});
