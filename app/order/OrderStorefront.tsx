"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  type CartLine,
  type MenuCategory,
  type MenuItem,
  type MenuModifier,
  type OrderMenuPayload,
  lineTotalCents,
} from "./types";
import { WalletCheckout, useOnlinePaymentsAvailable } from "./WalletCheckout";

/** Sticky topnav + category strip — keep in sync with .order-category scroll-margin. */
const CATEGORY_SCROLL_OFFSET_PX = 128;

type MenuCategoryWithSlug = MenuCategory & { slug: string };

function formatR(cents: number): string {
  const n = Math.round(cents);
  const whole = Math.floor(Math.abs(n) / 100);
  const frac = String(Math.abs(n) % 100).padStart(2, "0");
  return `R${whole}.${frac}`;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Human-readable URL label from a category name, e.g. "Pollo Pueblo" → "pollo-pueblo". */
function slugifyCategoryName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "category";
}

function withCategorySlugs(categories: MenuCategory[]): MenuCategoryWithSlug[] {
  const used = new Set<string>();
  return categories.map((cat) => {
    const base = slugifyCategoryName(cat.name);
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    used.add(slug);
    return { ...cat, slug };
  });
}

function visibleModifiers(item: MenuItem, isMeal: boolean | null): MenuModifier[] {
  return item.modifiers.filter((m) => {
    if (m.scope === "MEAL_ONLY") return isMeal === true;
    return true;
  });
}

/** Featured picks drawn only from real menu categories already on the store. */
function featuredFromMenu(categories: MenuCategory[]): { title: string; item: MenuItem }[] {
  const preferred = ["Familia Fiesta", "Combinacion", "Burger El' Supremo", "Pollo Pueblo", "Mexican Meals"];
  const picks: { title: string; item: MenuItem }[] = [];
  for (const name of preferred) {
    const cat = categories.find((c) => c.name === name);
    if (!cat?.items[0]) continue;
    picks.push({ title: cat.name, item: cat.items[0] });
    if (picks.length >= 4) break;
  }
  if (picks.length < 4) {
    for (const cat of categories) {
      if (picks.some((p) => p.item.id === cat.items[0]?.id)) continue;
      if (!cat.items[0]) continue;
      picks.push({ title: cat.name, item: cat.items[0] });
      if (picks.length >= 4) break;
    }
  }
  return picks;
}

export function OrderStorefront({ initial }: { initial: OrderMenuPayload }) {
  const categories = useMemo(() => withCategorySlugs(initial.categories), [initial.categories]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeCategory, setActiveCategory] = useState(categories[0]?.slug ?? "");
  const [configItem, setConfigItem] = useState<MenuItem | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [kitchenNotes, setKitchenNotes] = useState("");
  const [payMode, setPayMode] = useState<"collection" | "online">("collection");
  const [wallet, setWallet] = useState<{ clientSecret: string; publishableKey: string; paymentIntentId: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{
    orderNumber: string | null;
    totalCents: number;
    quotedPrepMinutes: number | null;
    paymentStatus?: string | null;
    paymentMethod?: string | null;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const onlinePayments = useOnlinePaymentsAvailable();
  const featured = useMemo(() => featuredFromMenu(categories), [categories]);
  const catsNavRef = useRef<HTMLElement | null>(null);
  const ignoreScrollSpyUntil = useRef(0);

  const totalCents = useMemo(() => cart.reduce((sum, line) => sum + lineTotalCents(line), 0), [cart]);
  const itemCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);

  useEffect(() => {
    if (!activeCategory && categories[0]) setActiveCategory(categories[0].slug);
  }, [activeCategory, categories]);

  // Highlight the category tab that matches the section currently under the sticky header.
  useEffect(() => {
    if (!categories.length) return;

    function categoryInView(): string {
      let current = categories[0]?.slug ?? "";
      for (const cat of categories) {
        const el = document.getElementById(cat.slug);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= CATEGORY_SCROLL_OFFSET_PX + 12) {
          current = cat.slug;
        }
      }
      return current;
    }

    function onScroll() {
      if (Date.now() < ignoreScrollSpyUntil.current) return;
      const next = categoryInView();
      if (!next) return;
      setActiveCategory((prev) => (prev === next ? prev : next));
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [categories]);

  // Keep the active tab visible in the horizontal category strip.
  useEffect(() => {
    const nav = catsNavRef.current;
    if (!nav || !activeCategory) return;
    const link = nav.querySelector<HTMLElement>(`a[href="#${CSS.escape(activeCategory)}"]`);
    if (!link) return;
    const navRect = nav.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const fullyVisible = linkRect.left >= navRect.left + 8 && linkRect.right <= navRect.right - 8;
    if (!fullyVisible) {
      link.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [activeCategory]);

  function selectCategory(slug: string) {
    ignoreScrollSpyUntil.current = Date.now() + 900;
    setActiveCategory(slug);
  }

  function openItem(item: MenuItem) {
    setError(null);
    setConfigItem(item);
  }

  function addConfigured(line: CartLine) {
    setCart((prev) => [...prev, line]);
    setConfigItem(null);
    setShowCart(true);
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function cartPayload() {
    return cart.map((line) => ({
      menuItemId: line.menuItemId,
      quantity: line.quantity,
      isMeal: line.isMeal,
      notes: line.notes,
      modifiers: line.modifiers.map((m) => ({
        groupId: m.groupId,
        optionIds: m.optionIds,
      })),
    }));
  }

  function placeOrder(opts?: { paymentIntentId?: string; onlineWallet?: "apple_pay" | "samsung_pay" | "google_pay" | "card" }) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/order/place", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone,
            name: name.trim() || undefined,
            notes: kitchenNotes.trim() || undefined,
            fulfilment: "COLLECTION",
            paymentIntentId: opts?.paymentIntentId,
            onlineWallet: opts?.onlineWallet,
            lines: cartPayload(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not place the order");
        setPlaced({
          orderNumber: data.orderNumber,
          totalCents: data.totalCents,
          quotedPrepMinutes: data.quotedPrepMinutes,
          paymentStatus: data.paymentStatus,
          paymentMethod: data.paymentMethod,
        });
        setCart([]);
        setWallet(null);
        setShowCheckout(false);
        setShowCart(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not place the order");
      }
    });
  }

  function startOnlinePayment() {
    setError(null);
    if (!phone.trim()) {
      setError("Enter your mobile number first");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/order/payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountCents: totalCents,
            phone,
            name: name.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not start online payment");
        setWallet({
          clientSecret: data.clientSecret,
          publishableKey: data.publishableKey,
          paymentIntentId: data.paymentIntentId,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start online payment");
      }
    });
  }

  const orderingDisabled =
    !initial.store.acceptingOrders ||
    !initial.store.webEnabled ||
    initial.store.billingStatus === "SUSPENDED";

  if (placed) {
    return (
      <main className="order-shell">
        <section className="order-success">
          <img src={initial.brand.logo} alt="Mochachos" className="order-logo" decoding="async" />
          <p className="order-kicker">Order received</p>
          <h1>{placed.orderNumber ?? "On the kitchen screen"}</h1>
          <p>
            Total {formatR(placed.totalCents)}. Collection at {initial.store.addressLine}, {initial.store.city}.
            {placed.quotedPrepMinutes
              ? ` Kitchen usually needs about ${placed.quotedPrepMinutes} minutes once they accept.`
              : null}
          </p>
          <p className="order-muted">
            {placed.paymentStatus === "PAID"
              ? `Paid online${placed.paymentMethod ? ` (${placed.paymentMethod.replace(/_/g, " ")})` : ""}.`
              : "Pay at the till when you collect."}{" "}
            We WhatsApp status updates to the number you gave — confirmed, cooking, and ready.
          </p>
          <button
            type="button"
            className="order-btn-primary"
            onClick={() => {
              setPlaced(null);
              setKitchenNotes("");
            }}
          >
            Order again
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="order-shell">
      <nav className="order-topnav" aria-label="Storefront">
        <a href="#menu" className="order-topnav-brand">
          <img src={initial.brand.mark} alt="Mochachos" width={40} height={40} decoding="async" />
          <span>
            <strong>Mochachos</strong>
            <small>Potchefstroom CBD</small>
          </span>
        </a>
        <div className="order-topnav-links">
          <a href="#featured">Favourites</a>
          <a href="#menu">Menu</a>
          <button
            type="button"
            className="order-topnav-cart"
            onClick={() => setShowCart(true)}
            aria-label={itemCount ? `Open cart, ${itemCount} items` : "Open cart"}
          >
            Cart{itemCount > 0 ? ` · ${itemCount}` : ""}
          </button>
        </div>
      </nav>

      <header className="order-hero" style={{ backgroundImage: `url(${initial.brand.hero})` }}>
        <div className="order-hero-veil" />
        <div className="order-hero-inner">
          <img
            src={initial.brand.logo}
            alt="Mochachos"
            className="order-logo-hero"
            fetchPriority="high"
            decoding="async"
          />
          <h1>Flame-Grilled. Full of Flavour.</h1>
          <p>
            {initial.store.name} · collection only at {initial.store.addressLine}, {initial.store.city}.
          </p>
          {initial.store.billingStatus === "SUSPENDED" || !initial.store.webEnabled ? (
            <p className="order-paused">
              {initial.store.suspendedReason ?? "Online ordering is unavailable right now."}
            </p>
          ) : !initial.store.acceptingOrders ? (
            <p className="order-paused">{initial.store.pausedReason ?? "Kitchen paused"}</p>
          ) : (
            <a className="order-btn-primary" href="#menu">
              Order now
            </a>
          )}
        </div>
      </header>

      <p className="order-fulfill-banner" role="note">
        Collection only — pay at the till or online, then collect at the counter. Prep is usually about{" "}
        {initial.store.defaultPrepMinutes} minutes once the kitchen accepts.
      </p>

      {featured.length > 0 ? (
        <section className="order-featured" id="featured" aria-labelledby="featured-heading">
          <div className="order-section-head">
            <h2 id="featured-heading">Kitchen favourites</h2>
            <p>Popular picks from the live menu — tap to customise and add.</p>
          </div>
          <ul className="order-featured-grid">
            {featured.map(({ title, item }) => (
              <li key={item.id}>
                <button type="button" className="order-featured-card" onClick={() => openItem(item)} disabled={orderingDisabled}>
                  <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
                  <span className="order-featured-copy">
                    <small>{title}</small>
                    <strong>{item.name}</strong>
                    <em>{formatR(item.priceCents)}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="order-cats" aria-label="Menu categories" ref={catsNavRef}>
        <div className="order-cats-track">
          {categories.map((cat) => (
            <a
              key={cat.id}
              href={`#${cat.slug}`}
              className={activeCategory === cat.slug ? "is-active" : undefined}
              aria-current={activeCategory === cat.slug ? "true" : undefined}
              onClick={() => selectCategory(cat.slug)}
            >
              {cat.name}
            </a>
          ))}
        </div>
      </nav>

      <div className="order-body" id="menu">
        {categories.map((cat) => (
          <CategoryBlock key={cat.id} category={cat} onPick={openItem} disabled={orderingDisabled} />
        ))}
      </div>

      <footer className="order-footer">
        <div className="order-footer-brand">
          <img src={initial.brand.logo} alt="Mochachos" decoding="async" />
          <div>
            <strong>{initial.store.name}</strong>
            <p>
              {initial.store.addressLine}, {initial.store.city}
            </p>
            <p>Collection orders only — same kitchen as WhatsApp.</p>
          </div>
        </div>
        <div className="order-footer-meta">
          <p>
            <span>Collection</span>
            Collect at the till. Typical prep {initial.store.defaultPrepMinutes} minutes after kitchen accept.
          </p>
          {initial.store.whatsappDisplay ? (
            <p>
              <span>WhatsApp</span>
              {initial.store.whatsappDisplay}
            </p>
          ) : null}
          <p>
            <span>Payment</span>
            Pay at collection, or pay online at checkout when available.
          </p>
        </div>
      </footer>

      {itemCount > 0 ? (
        <button type="button" className="order-cart-fab" onClick={() => setShowCart(true)}>
          <span>
            View order · {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          <strong>{formatR(totalCents)}</strong>
        </button>
      ) : null}

      {configItem ? (
        <ItemConfigurator
          item={configItem}
          zeeArt={initial.brand.zeeFlavours}
          onClose={() => setConfigItem(null)}
          onAdd={addConfigured}
        />
      ) : null}

      {showCart ? (
        <aside className="order-sheet" role="dialog" aria-label="Your order">
          <div className="order-sheet-panel">
            <header>
              <h2>Your order</h2>
              <button type="button" className="order-icon-btn" onClick={() => setShowCart(false)} aria-label="Close">
                ×
              </button>
            </header>
            {cart.length === 0 ? (
              <p className="order-muted">Nothing in the basket yet.</p>
            ) : (
              <ul className="order-cart-list">
                {cart.map((line) => (
                  <li key={line.key}>
                    <img src={line.imageUrl} alt="" />
                    <div>
                      <strong>
                        {line.quantity}× {line.name}
                        {line.isMeal ? " · meal" : ""}
                      </strong>
                      <span>
                        {line.modifiers.map((m) => m.optionNames.join(", ")).filter(Boolean).join(" · ") || "As listed"}
                      </span>
                      {line.notes ? <em>{line.notes}</em> : null}
                      <button type="button" onClick={() => removeLine(line.key)}>
                        Remove
                      </button>
                    </div>
                    <b>{formatR(lineTotalCents(line))}</b>
                  </li>
                ))}
              </ul>
            )}
            <footer>
              <div className="order-total-row">
                <span>Total</span>
                <strong>{formatR(totalCents)}</strong>
              </div>
              <p className="order-muted order-cart-fulfil">Collection at {initial.store.addressLine}</p>
              <button
                type="button"
                className="order-btn-primary order-btn-block"
                disabled={!cart.length || orderingDisabled}
                onClick={() => {
                  setShowCart(false);
                  setShowCheckout(true);
                }}
              >
                Checkout
              </button>
            </footer>
          </div>
        </aside>
      ) : null}

      {showCheckout ? (
        <aside className="order-sheet" role="dialog" aria-label="Checkout">
          <div className="order-sheet-panel">
            <header>
              <h2>Place order</h2>
              <button type="button" className="order-icon-btn" onClick={() => setShowCheckout(false)} aria-label="Close">
                ×
              </button>
            </header>
            <p className="order-muted">
              Collection at {initial.store.addressLine}. We use your number for WhatsApp updates only.
            </p>
            <label className="order-field">
              Mobile number
              <input
                inputMode="tel"
                placeholder="082 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </label>
            <label className="order-field">
              Name (optional)
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="How should we greet you?" />
            </label>
            <label className="order-field">
              Kitchen notes / allergies
              <textarea
                rows={3}
                value={kitchenNotes}
                onChange={(e) => setKitchenNotes(e.target.value)}
                placeholder="One note for the whole order — e.g. no onion, nut allergy"
              />
            </label>

            <fieldset className="order-choice-set">
              <legend>Payment</legend>
              <div className="order-chips">
                <button
                  type="button"
                  className={payMode === "collection" ? "is-on" : undefined}
                  onClick={() => {
                    setPayMode("collection");
                    setWallet(null);
                  }}
                >
                  Pay at collection
                </button>
                <button
                  type="button"
                  className={payMode === "online" ? "is-on" : undefined}
                  onClick={() => setPayMode("online")}
                >
                  Pay online
                </button>
              </div>
              <p className="order-muted">
                {payMode === "online"
                  ? "Apple Pay, Samsung Pay, Google Pay, or card — then we ticket the kitchen."
                  : "Pay at the till when you collect. Or switch to Pay online."}
              </p>
            </fieldset>

            {error ? <p className="order-error">{error}</p> : null}

            {payMode === "online" && onlinePayments === true && wallet ? (
              <WalletCheckout
                clientSecret={wallet.clientSecret}
                publishableKey={wallet.publishableKey}
                totalCents={totalCents}
                pending={pending}
                onError={(message) => setError(message || null)}
                onPaid={(paymentIntentId) => placeOrder({ paymentIntentId })}
              />
            ) : null}

            {payMode === "online" && onlinePayments === false ? (
              <div className="order-wallet">
                <p className="order-muted">
                  Choose how you want to pay online. Add Stripe keys later for live Apple Pay / Samsung Pay charges —
                  for now picking a wallet marks the kitchen ticket as paid.
                </p>
                <div className="order-chips">
                  {(
                    [
                      ["apple_pay", "Apple Pay"],
                      ["samsung_pay", "Samsung Pay"],
                      ["google_pay", "Google Pay"],
                      ["card", "Card"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      disabled={pending || !phone.trim()}
                      onClick={() => placeOrder({ onlineWallet: id })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <footer>
              <div className="order-total-row">
                <span>{payMode === "online" ? "Pay online" : "Pay at collection"}</span>
                <strong>{formatR(totalCents)}</strong>
              </div>
              {payMode === "collection" ? (
                <button
                  type="button"
                  className="order-btn-primary order-btn-block"
                  disabled={pending || !phone.trim()}
                  onClick={() => placeOrder()}
                >
                  {pending ? "Sending to kitchen…" : "Place order"}
                </button>
              ) : onlinePayments === true && !wallet ? (
                <button
                  type="button"
                  className="order-btn-primary order-btn-block"
                  disabled={pending || !phone.trim()}
                  onClick={startOnlinePayment}
                >
                  {pending ? "Preparing wallets…" : "Continue to wallets"}
                </button>
              ) : null}
            </footer>
          </div>
        </aside>
      ) : null}
    </main>
  );
}

function CategoryBlock({
  category,
  onPick,
  disabled,
}: {
  category: MenuCategoryWithSlug;
  onPick: (item: MenuItem) => void;
  disabled?: boolean;
}) {
  return (
    <section className="order-category" id={category.slug}>
      <div className="order-category-banner" style={{ backgroundImage: `url(${category.imageUrl})` }}>
        <div>
          <h2>{category.name}</h2>
          {category.description ? <p>{category.description}</p> : null}
        </div>
      </div>
      <ul className="order-item-list">
        {category.items.map((item) => (
          <li key={item.id}>
            <button type="button" className="order-item" onClick={() => onPick(item)} disabled={disabled}>
              <span className="order-item-media">
                <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
              </span>
              <span className="order-item-copy">
                <strong>{item.name}</strong>
                {item.description ? <small>{item.description}</small> : null}
                {item.mealUpgradeCents != null ? (
                  <em>
                    Meal +{formatR(item.mealUpgradeCents)} · {item.mealDescription}
                  </em>
                ) : null}
              </span>
              <span className="order-item-aside">
                <span className="order-item-price">{formatR(item.priceCents)}</span>
                <span className="order-item-add">Add</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItemConfigurator({
  item,
  zeeArt,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  zeeArt: string;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const canMeal = item.mealUpgradeCents != null;
  const [quantity, setQuantity] = useState(1);
  const [isMeal, setIsMeal] = useState<boolean | null>(canMeal ? null : false);
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [itemNotes, setItemNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const mods = visibleModifiers(item, isMeal);

  function toggleOption(mod: MenuModifier, optionId: string) {
    setChoices((prev) => {
      const current = prev[mod.groupId] ?? [];
      if (mod.selection === "SINGLE") return { ...prev, [mod.groupId]: [optionId] };
      const has = current.includes(optionId);
      const next = has ? current.filter((id) => id !== optionId) : [...current, optionId].slice(0, mod.maxSelect);
      return { ...prev, [mod.groupId]: next };
    });
  }

  function submit() {
    setLocalError(null);
    if (canMeal && isMeal === null) {
      setLocalError("Choose make it a meal, or on its own");
      return;
    }
    for (const mod of mods) {
      if (!mod.required) continue;
      const picked = choices[mod.groupId] ?? [];
      if (picked.length < mod.minSelect) {
        setLocalError(mod.prompt);
        return;
      }
    }

    const modifiers = mods
      .map((mod) => {
        const optionIds = choices[mod.groupId] ?? [];
        if (!optionIds.length) return null;
        const selected = mod.options.filter((o) => optionIds.includes(o.id));
        return {
          groupId: mod.groupId,
          groupName: mod.name,
          optionIds,
          optionNames: selected.map((o) => o.name),
          priceDeltaCents: selected.reduce((sum, o) => sum + o.priceDeltaCents, 0),
        };
      })
      .filter(Boolean) as CartLine["modifiers"];

    onAdd({
      key: uid(),
      menuItemId: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      quantity,
      unitPriceCents: item.priceCents,
      mealUpgradeCents: item.mealUpgradeCents ?? 0,
      isMeal: canMeal ? isMeal : false,
      mealDescription: item.mealDescription,
      modifiers,
      notes: itemNotes.trim() || undefined,
    });
  }

  const preview =
    (item.priceCents +
      (isMeal ? (item.mealUpgradeCents ?? 0) : 0) +
      mods.reduce((sum, mod) => {
        const ids = choices[mod.groupId] ?? [];
        return sum + mod.options.filter((o) => ids.includes(o.id)).reduce((s, o) => s + o.priceDeltaCents, 0);
      }, 0)) *
    quantity;

  return (
    <aside className="order-sheet" role="dialog" aria-label={`Configure ${item.name}`}>
      <div className="order-sheet-panel order-config">
        <header>
          <h2>{item.name}</h2>
          <button type="button" className="order-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="order-config-hero">
          <img src={item.imageUrl} alt="" />
          <p>{item.description}</p>
        </div>

        <label className="order-field">
          Quantity
          <div className="order-qty">
            <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
              −
            </button>
            <span>{quantity}</span>
            <button type="button" onClick={() => setQuantity((q) => Math.min(50, q + 1))} aria-label="Increase quantity">
              +
            </button>
          </div>
        </label>

        {canMeal ? (
          <fieldset className="order-choice-set">
            <legend>Make it a meal?</legend>
            <p className="order-muted">
              +{formatR(item.mealUpgradeCents ?? 0)}
              {item.mealDescription ? ` · ${item.mealDescription}` : ""}
            </p>
            <div className="order-chips">
              <button type="button" className={isMeal === true ? "is-on" : undefined} onClick={() => setIsMeal(true)}>
                Make it a meal
              </button>
              <button type="button" className={isMeal === false ? "is-on" : undefined} onClick={() => setIsMeal(false)}>
                On its own
              </button>
            </div>
          </fieldset>
        ) : null}

        {mods.map((mod) => (
          <fieldset key={mod.groupId} className="order-choice-set">
            <legend>
              {mod.name}
              {mod.required ? "" : " (optional)"}
            </legend>
            {/zee flavours/i.test(mod.name) ? <img src={zeeArt} alt="Zee Flavours" className="order-zee" /> : null}
            <p className="order-muted">{mod.prompt}</p>
            <div className="order-chips">
              {mod.options.map((opt) => {
                const on = (choices[mod.groupId] ?? []).includes(opt.id);
                return (
                  <button key={opt.id} type="button" className={on ? "is-on" : undefined} onClick={() => toggleOption(mod, opt.id)}>
                    {opt.name}
                    {opt.priceDeltaCents ? ` · +${formatR(opt.priceDeltaCents)}` : ""}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <label className="order-field">
          Leave-out for this item (optional)
          <input value={itemNotes} onChange={(e) => setItemNotes(e.target.value)} placeholder="e.g. no tomato" />
        </label>

        {localError ? <p className="order-error">{localError}</p> : null}

        <footer>
          <button type="button" className="order-btn-primary order-btn-block" onClick={submit}>
            Add to order · {formatR(preview)}
          </button>
        </footer>
      </div>
    </aside>
  );
}
