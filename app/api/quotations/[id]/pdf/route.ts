import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { getQuotationPdf } from "@/services/quotes/service";

export const GET = route<{ id: string }>(async ({ req, session, params }) => {
  const { data, filename } = await getQuotationPdf(session.businessId, params.id);
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
