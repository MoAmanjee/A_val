import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeedResult } from "@/db/seed";
import { GET as webhookGET, POST as webhookPOST } from "@/app/api/webhooks/whatsapp/route";
import { processWebhookPayload, wantsHuman } from "@/services/whatsapp/processor";
import { verifyWebhookSignature } from "@/services/whatsapp";
import { ScriptedLLM, call, prisma, resetAndSeed, say, useMockWhatsApp, waPayload } from "./helpers";

let s: SeedResult;
let wa: ReturnType<typeof useMockWhatsApp>;
const PHONE_A = "DEMO_PHONE_ID_ELITE";
const PHONE_B = "DEMO_PHONE_ID_CAPE";
let n = 0;
const wamid = () => `wamid.TEST${++n}`;

beforeAll(async () => {
  s = await resetAndSeed();
});
beforeEach(() => {
  wa = useMockWhatsApp();
});

const echoLLM = (reply = "Hi there! What car is it for?") => new ScriptedLLM(() => say(reply));

describe("WhatsApp webhook processing", () => {
  it("creates the customer and conversation, runs the AI and replies on WhatsApp", async () => {
    const llm = echoLLM();
    const summary = await processWebhookPayload(waPayload({ phoneNumberId: PHONE_A, from: "27831110001", id: wamid(), text: "Hi, I need brake pads", name: "Newbie" }), { llm });
    expect(summary).toMatchObject({ messages: 1, duplicates: 0, unrouted: 0, errors: [] });

    const customer = await prisma.customer.findFirstOrThrow({ where: { businessId: s.businessA.id, phone: "27831110001" } });
    const conv = await prisma.conversation.findFirstOrThrow({ where: { customerId: customer.id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    expect(conv.status).toBe("ACTIVE");
    const visible = conv.messages.filter((m) => m.messageType !== "NOTE");
    expect(visible.map((m) => [m.direction, m.sender])).toEqual([["INBOUND", "CUSTOMER"], ["OUTBOUND", "AI"]]);
    expect(visible[1].whatsappMessageId).toMatch(/^wamid\.MOCK/);
    expect(visible[1].deliveryStatus).toBe("SENT");
    expect(wa.outbox).toHaveLength(1);
    expect(wa.outbox[0]).toMatchObject({ kind: "text", to: "27831110001", text: "Hi there! What car is it for?", phoneNumberId: PHONE_A });
    expect(wa.read).toContain(visible[0].whatsappMessageId);
  });

  it("routes by phone number id so each message lands in the right business", async () => {
    await processWebhookPayload(waPayload({ phoneNumberId: PHONE_B, from: "27831110002", id: wamid(), text: "Hello" }), { llm: echoLLM("Hi from Cape") });
    const cust = await prisma.customer.findFirstOrThrow({ where: { phone: "27831110002" } });
    expect(cust.businessId).toBe(s.businessB.id);
    expect(wa.outbox.at(-1)!.phoneNumberId).toBe(PHONE_B);
    expect(await prisma.customer.count({ where: { businessId: s.businessA.id, phone: "27831110002" } })).toBe(0);
  });

  it("ignores messages for an unknown number without crashing", async () => {
    const llm = echoLLM();
    const summary = await processWebhookPayload(waPayload({ phoneNumberId: "NOPE", from: "27831110003", id: wamid(), text: "hi" }), { llm });
    expect(summary.unrouted).toBe(1);
    expect(llm.calls).toBe(0);
    expect(wa.outbox).toHaveLength(0);
  });

  it("processes a repeated delivery (same wamid) only once", async () => {
    const id = wamid();
    const payload = waPayload({ phoneNumberId: PHONE_A, from: "27831110004", id, text: "Need an oil filter" });
    const llm = echoLLM("Sure - which car?");
    await processWebhookPayload(payload, { llm });
    const again = await processWebhookPayload(payload, { llm });
    expect(again.duplicates).toBe(1);
    expect(llm.calls).toBe(1);
    expect(wa.outbox.filter((o) => o.to === "27831110004")).toHaveLength(1);
    expect(await prisma.message.count({ where: { whatsappMessageId: id } })).toBe(1);
  });

  it("hands over to a human on request and stops replying afterwards", async () => {
    const llm = echoLLM();
    await processWebhookPayload(waPayload({ phoneNumberId: PHONE_A, from: "27831110005", id: wamid(), text: "Can I speak to someone please?" }), { llm });
    expect(llm.calls).toBe(0);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { customer: { phone: "27831110005" } } });
    expect(conv.status).toBe("HUMAN_REQUIRED");
    expect(conv.handler).toBe("HUMAN");
    expect(wa.outbox.at(-1)!.text).toMatch(/team/i);

    const before = wa.outbox.length;
    await processWebhookPayload(waPayload({ phoneNumberId: PHONE_A, from: "27831110005", id: wamid(), text: "Hello?? anyone?" }), { llm });
    expect(llm.calls).toBe(0);
    expect(wa.outbox).toHaveLength(before);
    expect(await prisma.message.count({ where: { conversationId: conv.id, direction: "INBOUND" } })).toBe(2);
  });

  it("detects handoff phrases without false positives", () => {
    expect(wantsHuman("I want to talk to a real person")).toBe(true);
    expect(wantsHuman("connect me with the manager")).toBe(true);
    expect(wantsHuman("front brake pads for a Golf 7")).toBe(false);
    expect(wantsHuman("do you have a timing belt?")).toBe(false);
  });

  it("gives the customer a friendly reply and alerts the business with the real error when the AI fails", async () => {
    const llm = new ScriptedLLM(() => {
      throw new Error("OpenAI 500: secret internal stack trace");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await processWebhookPayload(waPayload({ phoneNumberId: PHONE_A, from: "27831110006", id: wamid(), text: "Brake pads please" }), { llm });
    const conv = await prisma.conversation.findFirstOrThrow({ where: { customer: { phone: "27831110006" } }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    expect(conv.status).toBe("HUMAN_REQUIRED");
    const customerFacing = conv.messages.filter((m) => m.direction === "OUTBOUND" && m.messageType !== "NOTE");
    expect(customerFacing).toHaveLength(1);
    expect(customerFacing[0].content).not.toMatch(/OpenAI|stack|500/);
    const note = conv.messages.find((m) => m.messageType === "NOTE" && /OpenAI 500/.test(m.content));
    expect(note).toBeTruthy();
    expect(wa.outbox.every((o) => !/OpenAI|stack/.test(o.text ?? ""))).toBe(true);
    vi.restoreAllMocks();
  });

  it("replies to media it cannot read with a helpful prompt", async () => {
    const payload = waPayload({ phoneNumberId: PHONE_A, from: "27831110007", id: wamid(), text: "" });
    const msg = payload.entry[0].changes[0].value.messages[0] as Record<string, unknown>;
    msg.type = "audio";
    delete msg.text;
    msg.audio = { id: "media-1" };
    const llm = echoLLM();
    await processWebhookPayload(payload, { llm });
    expect(llm.calls).toBe(0);
    expect(wa.outbox.at(-1)!.text).toMatch(/text/i);
  });

  it("keeps a failed outbound message visible and retryable", async () => {
    const { WhatsAppError } = await import("@/services/whatsapp");
    wa.failNext = new WhatsAppError("Recipient not in allowed list", true);
    await processWebhookPayload(waPayload({ phoneNumberId: PHONE_A, from: "27831110008", id: wamid(), text: "Hi" }), { llm: echoLLM("Hello!") });
    const conv = await prisma.conversation.findFirstOrThrow({ where: { customer: { phone: "27831110008" } } });
    const failed = await prisma.message.findFirstOrThrow({ where: { conversationId: conv.id, direction: "OUTBOUND", messageType: "TEXT" } });
    expect(failed.deliveryStatus).toBe("FAILED");
    expect(failed.error).toMatch(/allowed list/);

    const { retryFailedMessage } = await import("@/services/conversations");
    const out = await retryFailedMessage(s.actorA, conv.id, failed.id);
    expect(out.sent).toBe(true);
    const after = await prisma.message.findUniqueOrThrow({ where: { id: failed.id } });
    expect(after.deliveryStatus).toBe("SENT");
    expect(after.error).toBeNull();
  });

  it("applies delivery status updates to messages", async () => {
    await processWebhookPayload(waPayload({ phoneNumberId: PHONE_A, from: "27831110009", id: wamid(), text: "Hi" }), { llm: echoLLM() });
    const out = await prisma.message.findFirstOrThrow({ where: { direction: "OUTBOUND", messageType: "TEXT", conversation: { customer: { phone: "27831110009" } } } });
    const statusPayload = (status: string, extra: Record<string, unknown> = {}) => ({
      object: "whatsapp_business_account",
      entry: [{ id: "W", changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_A }, statuses: [{ id: out.whatsappMessageId, status, timestamp: "1700000000", recipient_id: "27831110009", ...extra }] } }] }],
    });
    await processWebhookPayload(statusPayload("delivered"));
    expect((await prisma.message.findUniqueOrThrow({ where: { id: out.id } })).deliveryStatus).toBe("DELIVERED");
    await processWebhookPayload(statusPayload("read"));
    expect((await prisma.message.findUniqueOrThrow({ where: { id: out.id } })).deliveryStatus).toBe("READ");
    await processWebhookPayload(statusPayload("delivered"));
    expect((await prisma.message.findUniqueOrThrow({ where: { id: out.id } })).deliveryStatus).toBe("READ");
    await processWebhookPayload(statusPayload("failed", { errors: [{ code: 131047, title: "Re-engagement message" }] }));
    const failed = await prisma.message.findUniqueOrThrow({ where: { id: out.id } });
    expect(failed.deliveryStatus).toBe("FAILED");
    expect(failed.error).toMatch(/Re-engagement/);
  });
});

describe("webhook HTTP endpoint", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    webhookPOST(new NextRequest("http://localhost:3000/api/webhooks/whatsapp", { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));

  it("answers the Meta verification handshake only with the right token", async () => {
    const ok = await webhookGET(new NextRequest("http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    const bad = await webhookGET(new NextRequest("http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345"));
    expect(bad.status).toBe(403);
  });

  it("verifies X-Hub-Signature-256", () => {
    const body = JSON.stringify({ a: 1 });
    const sig = "sha256=" + createHmac("sha256", "shh").update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig, "shh")).toBe(true);
    expect(verifyWebhookSignature(body + " ", sig, "shh")).toBe(false);
    expect(verifyWebhookSignature(body, null, "shh")).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=deadbeef", "shh")).toBe(false);
  });

  it("rejects malformed JSON", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
  });

  it("rejects bad signatures when an app secret is configured", async () => {
    const prev = process.env.WHATSAPP_APP_SECRET;
    process.env.WHATSAPP_APP_SECRET = "topsecret";
    try {
      const body = JSON.stringify(waPayload({ phoneNumberId: PHONE_A, from: "27831119999", id: wamid(), text: "hi" }));
      expect((await post(body, { "x-hub-signature-256": "sha256=00" })).status).toBe(401);
      expect((await post(body)).status).toBe(401);
    } finally {
      process.env.WHATSAPP_APP_SECRET = prev;
    }
  });
});

describe("agent tool loop through the webhook", () => {
  it("lets the model call tools and only sends the final reply to the customer", async () => {
    const llm = new ScriptedLLM(({ n: step }) => {
      if (step === 1) return call("update_customer", { name: "Sam Tester" });
      return say("Thanks Sam - what car is it for?");
    });
    await processWebhookPayload(waPayload({ phoneNumberId: PHONE_A, from: "27831110010", id: wamid(), text: "Hi I'm Sam, need pads" }), { llm });
    expect(llm.calls).toBe(2);
    const cust = await prisma.customer.findFirstOrThrow({ where: { businessId: s.businessA.id, phone: "27831110010" } });
    expect(cust.name).toBe("Sam Tester");
    expect(wa.outbox.filter((o) => o.to === "27831110010")).toHaveLength(1);
  });
});
