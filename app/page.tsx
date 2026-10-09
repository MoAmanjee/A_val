import Link from "next/link";
import { db } from "@/lib/db";
import { describeWhatsApp } from "@/services/promotions/broadcast";

export default async function HomePage() {
  let whatsapp = { live: false, detail: "WhatsApp is not live yet." };
  try {
    const store = await db.store.findFirst({ orderBy: { createdAt: "asc" } });
    whatsapp = describeWhatsApp(store);
  } catch {
    whatsapp = { live: false, detail: "WhatsApp status could not be read." };
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-red-700">Potchefstroom CBD</p>
      <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Mochachos WhatsApp ordering</h1>
      <p className={`rounded-2xl px-4 py-3 text-sm ${whatsapp.live ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}>
        {whatsapp.detail}
      </p>
      <p className="text-lg leading-relaxed text-neutral-700">
        Customers message the branch on WhatsApp, get the menu, and order one item or several. They can type the whole
        order, or tap through it. The order lands on the kitchen screen. The kitchen accepts it, and the customer is told
        when it is ready to collect at 17 Nelson Mandela Drive or when a delivery is on the way.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/kitchen" className="rounded-full bg-red-700 px-5 py-3 font-semibold text-white">
          Open the kitchen screen
        </Link>
        <Link href="/promotions" className="rounded-full border border-neutral-300 px-5 py-3 font-semibold">
          Send a promotion
        </Link>
        <a href="/menu/mochachos-menu-1.jpg" className="rounded-full border border-neutral-300 px-5 py-3 font-semibold">
          Menu, page 1
        </a>
        <a href="/menu/mochachos-menu-2.jpg" className="rounded-full border border-neutral-300 px-5 py-3 font-semibold">
          Menu, page 2
        </a>
        <a href="/menu/Mochachos-RSA-Menu-2026.pdf" className="rounded-full border border-neutral-300 px-5 py-3 font-semibold">
          Menu PDF
        </a>
      </div>
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 text-sm leading-relaxed text-neutral-700">
        <p className="font-semibold text-neutral-900">How a message is handled</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>A greeting offers two ways in: type the whole order, or browse the menu. A close spelling still counts, so burito is read as Burrito. A spice left out is asked per item. Type all hot when every item still waiting should match.</li>
          <li>When the basket is ready there are three buttons: Confirm order, Add to order, and Cancel order.</li>
          <li>Confirm order asks whether they want delivery and shows that price. The receipt then shows the total, including delivery. Accept sends it to the kitchen. Decline clears it.</li>
          <li>The kitchen accepts the ticket and later marks it ready. Both steps message the customer. They can also set the delivery price, including free.</li>
          <li>Shop questions (hours, delivery price, a meal, allergies) get a written answer. Ticket questions (how long, cancel, what is in it) are read from the order. Halaal is passed to the shop.</li>
        </ol>
      </section>
    </main>
  );
}
