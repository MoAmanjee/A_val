import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { exportPartsCsv } from "@/services/inventory";

export const GET = route(async ({ session }) => {
  const csv = await exportPartsCsv(session.businessId);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="inventory-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
});
