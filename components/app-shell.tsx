"use client";

import { clsx } from "clsx";
import {
  BarChart3, ClipboardList, FileText, History, LogOut, Menu, MessageSquare, PackageSearch, Settings, ShieldCheck, Truck, Users, UserCog, Wrench, X, Car, Link2, Clock,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client";

interface Counts { pendingQuotes: number; humanRequired: number; partRequests: number }

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/conversations", label: "Conversations", icon: MessageSquare, badge: "humanRequired" as const },
  { href: "/quotations", label: "Quotations", icon: FileText, badge: "pendingQuotes" as const },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/vehicles", label: "Vehicles", icon: Car },
  { href: "/inventory", label: "Inventory", icon: PackageSearch },
  { href: "/fitment", label: "Fitment", icon: Link2 },
  { href: "/part-requests", label: "Part requests", icon: ClipboardList, badge: "partRequests" as const },
  { href: "/labour", label: "Labour rates", icon: Wrench },
  { href: "/audit", label: "Audit log", icon: History },
  { href: "/users", label: "Users", icon: UserCog, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ user, businessName, children }: { user: { name: string; email: string; role: string }; businessName: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    let alive = true;
    const load = () => api<Counts>("/api/dashboard").then((c) => alive && setCounts(c)).catch(() => undefined);
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
      {NAV.filter((n) => !n.adminOnly || user.role !== "STAFF").map((n) => {
        const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
        const badge = n.badge && counts ? counts[n.badge] : 0;
        return (
          <Link
            key={n.href}
            href={n.href}
            className={clsx(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-brand-600 text-white shadow" : "text-slate-300 hover:bg-white/10 hover:text-white",
            )}
          >
            <n.icon className="h-[18px] w-[18px] shrink-0" />
            <span className="flex-1">{n.label}</span>
            {badge > 0 && (
              <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-bold", active ? "bg-white text-brand-700" : n.badge === "humanRequired" ? "bg-red-500 text-white" : "bg-brand-500 text-white")}>{badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600"><Truck className="h-5 w-5 text-white" /></span>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-white">{businessName}</p>
        <p className="text-[11px] text-slate-400">AutoQuote dashboard</p>
      </div>
    </div>
  );

  const account = (
    <div className="border-t border-white/10 p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">{user.name.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{user.name}</p>
          <p className="flex items-center gap-1 text-[11px] text-slate-400"><ShieldCheck className="h-3 w-3" />{user.role.replace("_", " ").toLowerCase()}</p>
        </div>
        <button onClick={logout} title="Sign out" aria-label="Sign out" className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"><LogOut className="h-4 w-4" /></button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-panel lg:flex">
        {brand}
        {nav}
        {account}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-panel">
            <button className="absolute right-3 top-4 text-slate-400" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            {brand}
            {nav}
            {account}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded p-1 text-slate-600"><Menu className="h-6 w-6" /></button>
          <span className="text-sm font-bold text-slate-800">{businessName}</span>
          {counts && counts.pendingQuotes > 0 && (
            <Link href="/quotations?status=PENDING_APPROVAL" className="ml-auto inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700"><Clock className="h-3 w-3" />{counts.pendingQuotes} to review</Link>
          )}
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
