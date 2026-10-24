import type { Metadata } from "next";
import { PAYFAST_LINKS } from "@/services/payments/payfast";
import { PayfastTemplateCopy } from "./template-copy";

export const metadata: Metadata = {
  title: "PayFast setup — restaurant guide",
  description: "Create your PayFast account and send the keys so online ordering can take card payments.",
};

const STEPS = [
  {
    title: "Open a PayFast account",
    body: "Use the business / restaurant details that match your bank account. Complete the ID and bank verification PayFast asks for — live payments stay off until they approve you.",
  },
  {
    title: "Find your integration keys",
    body: "After you can sign in, open Settings → Integration (or Integration → Integration details). Copy Merchant ID, Merchant Key, and set a Salt Passphrase if PayFast offers one.",
  },
  {
    title: "Send us three things",
    body: "WhatsApp or email us: (1) Merchant ID, (2) Merchant Key, (3) Salt Passphrase if you set one. Say whether you are still on sandbox testing or ready for live.",
  },
  {
    title: "We wire it on our side",
    body: "We paste those keys into your site’s payment settings. When live mode is on, customers can pay online on your order link; money settles to your PayFast / bank account — not ours.",
  },
] as const;

export default function PayfastSetupPage() {
  return (
    <main className="payfast-guide">
      <div className="payfast-guide-bg" aria-hidden />
      <header className="payfast-guide-hero">
        <p className="payfast-guide-brand">Ordering platform</p>
        <h1>PayFast setup</h1>
        <p className="payfast-guide-lede">
          Follow these steps once. Then send your keys back so we can turn on online pay for your customers.
        </p>
        <div className="payfast-guide-cta">
          <a className="payfast-guide-primary" href={PAYFAST_LINKS.signup} target="_blank" rel="noreferrer">
            Create PayFast account
          </a>
          <a className="payfast-guide-secondary" href={PAYFAST_LINKS.login} target="_blank" rel="noreferrer">
            I already have an account
          </a>
        </div>
      </header>

      <section className="payfast-guide-section" aria-labelledby="steps-heading">
        <h2 id="steps-heading">What to do</h2>
        <ol className="payfast-guide-steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="payfast-guide-num">{i + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="payfast-guide-section" aria-labelledby="send-heading">
        <h2 id="send-heading">Message template</h2>
        <p>Fill this in and WhatsApp it back to us:</p>
        <PayfastTemplateCopy
          text={`Hi — here are my PayFast details for online ordering:

Shop name:
Merchant ID:
Merchant Key:
Salt Passphrase: (or "none")
Mode: sandbox / live
`}
        />
      </section>

      <section className="payfast-guide-section payfast-guide-tips" aria-labelledby="tips-heading">
        <h2 id="tips-heading">Quick tips</h2>
        <ul>
          <li>Never post your Merchant Key in a public group — send it in a private chat or email.</li>
          <li>Sandbox is for testing with fake money. Switch to live only after a real test order works.</li>
          <li>
            PayFast docs if your bookkeeper needs them:{" "}
            <a href={PAYFAST_LINKS.docs} target="_blank" rel="noreferrer">
              developers.payfast.co.za
            </a>
          </li>
        </ul>
      </section>
    </main>
  );
}
