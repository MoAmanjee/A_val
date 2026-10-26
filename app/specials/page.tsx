import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { FACEBOOK_PAGE_URL, STORE_MAP } from "@/lib/store-contact";
import { env } from "@/lib/env";
import { ORDER_BRAND } from "@/services/menu/web-images";
import { activeWebsitePromoWhere, formatScheduleLabel } from "@/services/promotions/schedule";
import { formatCents } from "@/utils/money";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Specials — Mochachos Potch CBD",
  description:
    "Current website specials from Mochachos Potchefstroom CBD. Flame-grilled Mexican chicken deals — order online for collection at 17 Nelson Mandela Drive.",
  alternates: { canonical: "/specials" },
};

type PublicPromo = {
  id: string;
  body: string | null;
  imagePath: string | null;
  priceCents: number | null;
  menuItemId: string | null;
  scheduleLabel: string;
};

async function loadActiveSpecials(): Promise<{ storeName: string; address: string; promos: PublicPromo[] }> {
  const store = await db.store.findFirst({ orderBy: { createdAt: "asc" } });
  if (!store) {
    return { storeName: "Mochachos Potch CBD", address: "17 Nelson Mandela Dr, Potchefstroom", promos: [] };
  }

  const rows = await db.promotion.findMany({
    where: { storeId: store.id, ...activeWebsitePromoWhere() },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      body: true,
      imagePath: true,
      priceCents: true,
      menuItemId: true,
      scheduleKind: true,
      startsAt: true,
      endsAt: true,
    },
  });

  return {
    storeName: store.tradingName ?? store.name,
    address: `${store.addressLine}, ${store.city}`,
    promos: rows.map((row) => ({
      id: row.id,
      body: row.body,
      imagePath: row.imagePath,
      priceCents: row.priceCents,
      menuItemId: row.menuItemId,
      scheduleLabel: formatScheduleLabel(row.scheduleKind, row.startsAt, row.endsAt),
    })),
  };
}

export default async function SpecialsPage() {
  const { storeName, address, promos } = await loadActiveSpecials();
  const site = env.appUrl.replace(/\/$/, "") || "https://mochachospotch.co.za";

  return (
    <main className="specials-shell">
      <nav className="order-topnav specials-topnav" aria-label="Storefront">
        <Link href="/order" className="order-topnav-brand">
          <img src={ORDER_BRAND.mark} alt="Mochachos" width={40} height={40} decoding="async" />
          <span>
            <strong>Mochachos</strong>
            <small>Potchefstroom CBD</small>
          </span>
        </Link>
        <div className="order-topnav-links">
          <Link href="/order">Order</Link>
          <Link href="/order#menu">Menu</Link>
          <a href={FACEBOOK_PAGE_URL} target="_blank" rel="noopener noreferrer">
            Facebook
          </a>
        </div>
      </nav>

      <header className="specials-hero" style={{ backgroundImage: `url(${ORDER_BRAND.hero})` }}>
        <div className="specials-hero-veil" />
        <div className="specials-hero-inner">
          <img src={ORDER_BRAND.logo} alt="Mochachos" className="order-logo-hero" fetchPriority="high" decoding="async" />
          <p className="order-kicker">Potchefstroom CBD specials</p>
          <h1>Today&apos;s flame deals</h1>
          <p>Kitchen-set specials while they last. Order online and collect at {address}.</p>
          <div className="specials-hero-actions">
            <Link href="/order" className="order-btn-primary">
              Order now
            </Link>
            <a className="specials-hero-ghost" href="#current">
              See current specials
            </a>
          </div>
        </div>
      </header>

      <section className="specials-list" id="current" aria-labelledby="specials-heading">
        <div className="specials-list-head">
          <p className="order-kicker">Live on the site</p>
          <h2 id="specials-heading">{promos.length ? "Current specials" : "No current specials"}</h2>
          <p>
            {promos.length
              ? "These deals are active right now. When the kitchen schedule ends, they come off automatically."
              : "There are no website specials right now. Check back soon, or order from the full menu."}
          </p>
        </div>

        {promos.length === 0 ? (
          <div className="specials-empty">
            <p>No specials on the board.</p>
            <Link href="/order" className="order-btn-primary">
              Browse the menu
            </Link>
          </div>
        ) : (
          <ul className="specials-grid">
            {promos.map((promo, index) => {
              const title = promo.body?.split("\n")[0]?.trim() || "Kitchen special";
              const rest = promo.body?.split("\n").slice(1).join("\n").trim() || "";
              return (
                <li key={promo.id} className="specials-card" style={{ animationDelay: `${Math.min(index, 4) * 60}ms` }}>
                  {promo.imagePath ? (
                    <div className="specials-card-media">
                      <img
                        src={`/${promo.imagePath.replace(/^\//, "")}`}
                        alt=""
                        loading={index === 0 ? "eager" : "lazy"}
                        decoding="async"
                      />
                    </div>
                  ) : (
                    <div className="specials-card-media specials-card-media--fallback" aria-hidden>
                      <img src={ORDER_BRAND.mark} alt="" />
                    </div>
                  )}
                  <div className="specials-card-copy">
                    {promo.scheduleLabel ? <span className="specials-badge">{promo.scheduleLabel}</span> : null}
                    <h3>{title}</h3>
                    {rest ? <p className="specials-body">{rest}</p> : null}
                    {promo.priceCents != null ? (
                      <p className="specials-price">{formatCents(promo.priceCents, "R")}</p>
                    ) : null}
                    <Link
                      href={promo.menuItemId ? `/order?promo=${encodeURIComponent(promo.id)}` : "/order"}
                      className="specials-order-link"
                    >
                      {promo.menuItemId ? "Order this special" : "Browse the menu"}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="order-footer specials-footer">
        <div className="order-footer-brand">
          <img src={ORDER_BRAND.logo} alt="Mochachos" decoding="async" />
          <div>
            <strong>{storeName}</strong>
            <p>{address}</p>
            <p>
              <a href={FACEBOOK_PAGE_URL} target="_blank" rel="noopener noreferrer">
                Facebook
              </a>
              {" · "}
              <Link href="/order">Order online</Link>
            </p>
          </div>
        </div>
        <div className="order-footer-map">
          <p>
            <span>Find us</span>
            {STORE_MAP.label}
          </p>
          <div className="order-map-frame">
            <iframe
              title="Map of Mochachos Potchefstroom CBD"
              src={STORE_MAP.embedSrc}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
          <a className="order-map-link" href={STORE_MAP.directionsUrl} target="_blank" rel="noopener noreferrer">
            Open in Google Maps
          </a>
        </div>
        <p className="specials-footer-note">
          <a href={site}>mochachospotch.co.za</a>
        </p>
      </footer>
    </main>
  );
}
