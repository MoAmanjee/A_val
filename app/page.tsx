import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-red-700">Potchefstroom CBD</p>
      <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Mochachos WhatsApp ordering</h1>
      <p className="text-lg leading-relaxed text-neutral-700">
        Customers message the branch on WhatsApp, get the menu, choose a flavour and a meal, and confirm the total.
        The order lands on the kitchen screen. The kitchen accepts it, and the customer is told when it is ready to collect
        at 17 Nelson Mandela Drive.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/kitchen" className="rounded-full bg-red-700 px-5 py-3 font-semibold text-white">
          Open the kitchen screen
        </Link>
        <a href="/menu/mochachos-menu-1.jpg" className="rounded-full border border-neutral-300 px-5 py-3 font-semibold">
          Menu, page 1
        </a>
        <a href="/menu/mochachos-menu-2.jpg" className="rounded-full border border-neutral-300 px-5 py-3 font-semibold">
          Menu, page 2
        </a>
      </div>
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 text-sm leading-relaxed text-neutral-700">
        <p className="font-semibold text-neutral-900">How a message is handled</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>A greeting sends the menu pictures and the sections to tap.</li>
          <li>The bot asks one thing at a time: flavour, meal, drink, then anything else.</li>
          <li>The customer confirms the total before anything reaches the kitchen.</li>
          <li>The kitchen accepts the ticket and later marks it ready. Both steps message the customer.</li>
        </ol>
      </section>
    </main>
  );
}
