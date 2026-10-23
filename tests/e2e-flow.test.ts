import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { SeedResult } from "@/db/seed";
import { SESSION_COOKIE, signSessionToken } from "@/services/auth";
import { updateQuotation, approveQuotation, sendQuotation } from "@/services/quotes/service";
import { processWebhookPayload } from "@/services/whatsapp/processor";
import { WhatsAppError } from "@/services/whatsapp";
import type { ChatMessage } from "@/services/ai";
import { ScriptedLLM, call, prisma, resetAndSeed, say, useMockWhatsApp, waPayload } from "./helpers";
import { POST as approvePOST } from "@/app/api/quotations/[id]/approve/route";
import { POST as sendPOST } from "@/app/api/quotations/[id]/send/route";

let s: SeedResult;
let wa: ReturnType<typeof useMockWhatsApp>;
const PHONE = "DEMO_PHONE_ID_ELITE";
const FROM = "27835550123";

const lastUser = (messages: ChatMessage[]) => [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
const toolResults = (messages: ChatMessage[]) => messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content as string));
const lastAssistantWasTool = (messages: ChatMessage[]) => messages[messages.length - 1]?.role === "tool";

beforeAll(async () => {
  s = await resetAndSeed();
  wa = useMockWhatsApp();
});

async function api(url: string, userId: string, body: unknown = {}) {
  const token = await signSessionToken(userId);
  return new NextRequest(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify(body),
  });
}

describe("end to end: WhatsApp enquiry -> AI draft -> business approval -> PDF on WhatsApp", () => {
  let quoteId: string;

  it("collects details progressively and submits a quote for approval (nothing is sent to the customer yet)", async () => {
    const llm = new ScriptedLLM(({ messages }) => {
      const text = lastUser(messages).toLowerCase();
      const results = toolResults(messages);
      if (text.includes("brake pads")) return say("Happy to help! What car is it for (make, model and year)?");
      if (text.includes("golf")) {
        if (!lastAssistantWasTool(messages)) return call("create_vehicle", { make: "VW", model: "Golf 7", year: 2016, engine: "1.4 TSI" });
        return say("Got it - a 2016 Golf 7. And what's your name?");
      }
      if (text.includes("i'm john") || text.includes("my name")) {
        if (!lastAssistantWasTool(messages)) return call("update_customer", { name: "Johnny Test" });
        const last = results[results.length - 1];
        if (last?.customer) return call("search_parts", { query: "front brake pads" });
        const found = results.find((r) => r.results);
        const lookup = (results.filter((r) => r.results).at(-1) ?? found) as { results: { part_id: string; sku: string }[] };
        if (results.every((r) => !r.quote_id)) {
          const pick = lookup.results.find((r) => r.sku === "BSH-BP-G7F")!;
          return call("create_quote", { items: [{ part_id: pick.part_id, quantity: 1 }], notes_for_business: "Customer asked for front brake pads." });
        }
        if (!results.some((r) => r.status === "PENDING_APPROVAL")) return call("submit_quote_for_approval", {});
        return say("Thanks Johnny! I've sent your request to the team - they'll review it and send your official quotation shortly.");
      }
      return say("Sorry, could you tell me a bit more?");
    });

    for (const [i, text] of ["Hi I need brake pads", "It's a 2016 VW Golf 7 1.4 TSI", "I'm John, front pads please"].entries()) {
      const summary = await processWebhookPayload(waPayload({ phoneNumberId: PHONE, from: FROM, id: `wamid.E2E${i}`, text, name: "Johnny" }), { llm });
      expect(summary.errors).toEqual([]);
    }

    const replies = wa.outbox.filter((o) => o.to === FROM);
    expect(replies).toHaveLength(3);
    expect(replies.every((r) => r.kind === "text")).toBe(true);
    expect(replies.at(-1)!.text).toMatch(/team/i);

    const quote = await prisma.quotation.findFirstOrThrow({ where: { businessId: s.businessA.id, customer: { phone: FROM } }, include: { items: true, customer: true, vehicle: true } });
    quoteId = quote.id;
    expect(quote.status).toBe("PENDING_APPROVAL");
    expect(quote.source).toBe("AI");
    expect(quote.customer.name).toBe("Johnny Test");
    expect(quote.vehicle).toMatchObject({ make: "Volkswagen", model: "Golf 7", year: 2016 });
    expect(quote.items[0].sku).toBe("BSH-BP-G7F");
    expect(quote.sentAt).toBeNull();
    expect(wa.outbox.some((o) => o.kind === "document")).toBe(false);
  });

  it("lets the business edit prices and lines; totals are recomputed server-side", async () => {
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quoteId }, include: { items: true } });
    const updated = await updateQuotation(s.actorA, quoteId, {
      items: [{ id: q.items[0].id, quantity: 2, unitPrice: 800, discount: 100 }],
      labour: [{ description: "Fit pads", hours: 1, unitPrice: 500 }],
      notes: "Includes fitting.",
    });
    // (2 x 800 + 500 labour - 100 discount) = 2000, + 15% VAT = 2300
    expect(Number(updated.subtotal)).toBe(1600);
    expect(Number(updated.discount)).toBe(100);
    expect(Number(updated.total)).toBe(2300);
    expect(updated.status).toBe("PENDING_APPROVAL");
  });

  it("failed WhatsApp delivery: not marked SENT, error kept, retryable", async () => {
    wa.failNext = new WhatsAppError("Meta API unavailable", true);
    const res = await approvePOST(await api(`/api/quotations/${quoteId}/approve`, s.adminA.id, { send: true }), { params: Promise.resolve({ id: quoteId }) });
    const body = await res.json();
    expect(res.status).toBeLessThan(500);
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quoteId } });
    expect(q.status).toBe("APPROVED");
    expect(q.approvedById).toBe(s.adminA.id);
    expect(q.sentAt).toBeNull();
    expect(q.sendError).toMatch(/Meta API unavailable/);
    expect(q.pdfKey).toBeTruthy();
    expect(JSON.stringify(body)).toMatch(/Meta API unavailable/);
  });

  it("retry sends the PDF, records message id and timestamp, and locks the price", async () => {
    const res = await sendPOST(await api(`/api/quotations/${quoteId}/send`, s.adminA.id), { params: Promise.resolve({ id: quoteId }) });
    expect(res.status).toBe(200);
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quoteId } });
    expect(q.status).toBe("SENT");
    expect(q.sentAt).not.toBeNull();
    expect(q.whatsappMessageId).toMatch(/^wamid\.MOCK/);
    expect(q.sendError).toBeNull();

    const doc = wa.outbox.filter((o) => o.kind === "document" && o.to === FROM);
    expect(doc).toHaveLength(1);
    expect(doc[0].document!.subarray(0, 5).toString()).toBe("%PDF-");
    expect(doc[0].filename).toMatch(/\.pdf$/);
    expect(doc[0].caption).toContain(q.quoteNumber);

    await expect(updateQuotation(s.actorA, quoteId, { notes: "sneaky change" })).rejects.toThrow();

    const trail = await prisma.auditLog.findMany({ where: { entityId: quoteId }, orderBy: { createdAt: "asc" } });
    const actions = trail.map((t) => t.action);
    for (const a of ["quote.create", "quote.submit", "quote.approve", "quote.send_failed", "quote.send"]) expect(actions).toContain(a);
    expect(trail.find((t) => t.action === "quote.approve")!.userId).toBe(s.adminA.id);
  });

  it("the conversation shows the document and AI replies still work afterwards", async () => {
    const conv = await prisma.conversation.findFirstOrThrow({ where: { customer: { phone: FROM } }, include: { messages: true } });
    expect(conv.messages.some((m) => m.messageType === "DOCUMENT" && m.direction === "OUTBOUND")).toBe(true);
    const llm = new ScriptedLLM(() => say("You're welcome!"));
    await processWebhookPayload(waPayload({ phoneNumberId: PHONE, from: FROM, id: "wamid.E2E-thanks", text: "Thanks!" }), { llm });
    expect(wa.outbox.at(-1)!.text).toBe("You're welcome!");
  });

  it("re-approving a sent quote is rejected and does not re-send", async () => {
    const before = wa.outbox.length;
    await expect(approveQuotation(s.actorA, quoteId, { send: true })).rejects.toThrow();
    expect(wa.outbox.length).toBe(before);
    void sendQuotation;
  });
});
