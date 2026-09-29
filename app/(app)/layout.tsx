import { requireSession } from "@/lib/session";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const business = await (await import("@/lib/db")).db.business.findUnique({ where: { id: session.businessId }, select: { name: true, tradingName: true, logoUrl: true } });
  return (
    <AppShell user={{ name: session.user.name, email: session.user.email, role: session.user.role }} businessName={business?.tradingName || business?.name || "Your business"}>
      {children}
    </AppShell>
  );
}
