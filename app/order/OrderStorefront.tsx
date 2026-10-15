"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  type CartLine,
  type MenuCategory,
  type MenuItem,
  type MenuModifier,
  type OrderMenuPayload,
  lineTotalCents,
} from "./types";
import { WalletCheckout, useOnlinePaymentsAvailable } from "./WalletCheckout";

function formatR(cents: number): string {
  const n = Math.round(cents);
  const whole = Math.floor(Math.abs(n) / 100);
  const frac = String(Math.abs(n) % 100).padStart(2, "0");
  return `R${whole}.${frac}`;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function visibleModifiers(item: MenuItem, isMeal: boolean | null): MenuModifier[] {
  return item.modifiers.filter((m) => {
    if (m.scope === "MEAL_ONLY") return isMeal === true;
    return true;
  });
}

export function OrderStorefront({ initial }: { initial: OrderMenuPayload }) {
  const [categories] = useState(initial.categories);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id ?? "");
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

  const totalCents = useMemo(() => cart.reduce((sum, line) => sum + lineTotalCents(line), 0), [cart]);
  const itemCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);

  useEffect(() => {
    if (!activeCategory && categories[0]) setActiveCategory(categories[0].id);
  }, [activeCategory, categories]);

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

  function placeOrder(paymentIntentId?: string) {
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
            paymentIntentId,
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

  if (placed) {
    return (
      <main className="order-shell">
        <section className="order-success">
          <img src={initial.brand.logo} alt="Mochachos" className="order-logo" />
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
      <header className="order-hero" style={{ backgroundImage: `url(${initial.brand.hero})` }}>
        <div className="order-hero-veil" />
        <div className="order-hero-inner">
          <img src={initial.brand.logo} alt="Mochachos" className="order-logo-hero" />
          <h1>Order for collection</h1>
          <p>
            Potchefstroom CBD · pick spice, make it a meal, add kitchen notes — then we ticket the same kitchen as
            WhatsApp.
          </p>
          {!initial.store.acceptingOrders ? (
            <p className="order-paused">{initial.store.pausedReason ?? "Kitchen paused"}</p>
          ) : (
            <a className="order-btn-primary" href={`#cat-${categories[0]?.id ?? ""}`}>
              Browse the menu
            </a>
          )}
        </div>
      </header>

      <nav className="order-cats" aria-label="Menu categories">
        {categories.map((cat) => (
          <a
            key={cat.id}
            href={`#cat-${cat.id}`}
            className={activeCategory === cat.id ? "is-active" : undefined}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.name}
          </a>
        ))}
      </nav>

      <div className="order-body">
        {categories.map((cat) => (
          <CategoryBlock key={cat.id} category={cat} onPick={openItem} />
        ))}
      </div>

      {itemCount > 0 ? (
        <button type="button" className="order-cart-fab" onClick={() => setShowCart(true)}>
          <span>
            {itemCount} item{itemCount === 1 ? "" : "s"}
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
              <button
                type="button"
                className="order-btn-primary"
                disabled={!cart.length || !initial.store.acceptingOrders}
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
                  disabled={onlinePayments === false}
                  onClick={() => setPayMode("online")}
                  title={
                    onlinePayments === false
                      ? "Add STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to enable wallets"
                      : "Apple Pay, Samsung Pay, Google Pay, card"
                  }
                >
                  Apple / Samsung Pay
                </button>
              </div>
              {onlinePayments === false ? (
                <p className="order-muted">Online wallets need Stripe keys on the server — pay at collection still works.</p>
              ) : (
                <p className="order-muted">Apple Pay, Samsung Pay, Google Pay, and cards when you choose online pay.</p>
              )}
            </fieldset>

            {error ? <p className="order-error">{error}</p> : null}

            {payMode === "online" && wallet ? (
              <WalletCheckout
                clientSecret={wallet.clientSecret}
                publishableKey={wallet.publishableKey}
                totalCents={totalCents}
                pending={pending}
                onError={(message) => setError(message || null)}
                onPaid={(paymentIntentId) => placeOrder(paymentIntentId)}
              />
            ) : null}

            <footer>
              <div className="order-total-row">
                <span>{payMode === "online" ? "Pay online" : "Pay at collection"}</span>
                <strong>{formatR(totalCents)}</strong>
              </div>
              {payMode === "collection" ? (
                <button
                  type="button"
                  className="order-btn-primary"
                  disabled={pending || !phone.trim()}
                  onClick={() => placeOrder()}
                >
                  {pending ? "Sending to kitchen…" : "Place order"}
                </button>
              ) : !wallet ? (
                <button
                  type="button"
                  className="order-btn-primary"
                  disabled={pending || !phone.trim() || onlinePayments === false}
                  onClick={startOnlinePayment}
                >
                  {pending ? "Preparing wallets…" : "Continue to Apple / Samsung Pay"}
                </button>
              ) : null}
            </footer>
          </div>
        </aside>
      ) : null}
    </main>
  );
}

function CategoryBlock({ category, onPick }: { category: MenuCategory; onPick: (item: MenuItem) => void }) {
  return (
    <section className="order-category" id={`cat-${category.id}`}>
      <div className="order-category-banner" style={{ backgroundImage: `url(${category.imageUrl})` }}>
        <div>
          <h2>{category.name}</h2>
          {category.description ? <p>{category.description}</p> : null}
        </div>
      </div>
      <ul className="order-item-list">
        {category.items.map((item) => (
          <li key={item.id}>
            <button type="button" className="order-item" onClick={() => onPick(item)}>
              <img src={item.imageUrl} alt="" loading="lazy" />
              <span className="order-item-copy">
                <strong>{item.name}</strong>
                {item.description ? <small>{item.description}</small> : null}
                {item.mealUpgradeCents != null ? (
                  <em>Meal +{formatR(item.mealUpgradeCents)} · {item.mealDescription}</em>
                ) : null}
              </span>
              <span className="order-item-price">{formatR(item.priceCents)}</span>
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
    (item.priceCents + (isMeal ? item.mealUpgradeCents ?? 0 : 0) +
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
            <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
              −
            </button>
            <span>{quantity}</span>
            <button type="button" onClick={() => setQuantity((q) => Math.min(50, q + 1))}>
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
          <button type="button" className="order-btn-primary" onClick={submit}>
            Add · {formatR(preview)}
          </button>
        </footer>
      </div>
    </aside>
  );
}
