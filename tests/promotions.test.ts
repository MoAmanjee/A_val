import { describe, expect, it } from "vitest";
import { classifyRecipient, parsePromoPrice, promoItemName, promotionOutbound, SESSION_WINDOW_MS } from "@/services/promotions/broadcast";
import { decodeReplyId } from "@/services/messaging/reply-ids";
import { toGraphMessage } from "@/services/whatsapp/cloud";

describe("promotion audience", () => {
  const now = new Date("2026-10-09T10:00:00.000Z");
  const dayMs = 24 * 60 * 60 * 1000;

  it("uses a 30-day audience window", () => {
    expect(SESSION_WINDOW_MS).toBe(30 * dayMs);
  });

  it("keeps customers who messaged inside the last month", () => {
    expect(classifyRecipient(new Date(now.getTime() - 60 * 60 * 1000), now)).toBe("open");
    expect(classifyRecipient(new Date(now.getTime() - 14 * dayMs), now)).toBe("open");
    expect(classifyRecipient(new Date(now.getTime() - SESSION_WINDOW_MS + 1000), now)).toBe("open");
  });

  it("skips customers whose last message is older than a month", () => {
    expect(classifyRecipient(new Date(now.getTime() - SESSION_WINDOW_MS), now)).toBe("closed");
    expect(classifyRecipient(new Date(now.getTime() - 45 * dayMs), now)).toBe("closed");
    expect(classifyRecipient(null, now)).toBe("unknown");
  });
});

describe("promotion message", () => {
  it("sends a picture, text, or both", () => {
    const media = { mediaId: "mid" };
    expect(promotionOutbound({ text: "Wings tonight", media })).toEqual({
      kind: "image",
      media,
      caption: "Wings tonight",
    });
    expect(promotionOutbound({ text: null, media })).toEqual({ kind: "image", media });
    expect(promotionOutbound({ text: "Wings tonight", media: null })).toEqual({ kind: "text", text: "Wings tonight" });
  });

  it("refuses an empty promotion", () => {
    expect(() => promotionOutbound({ text: "   ", media: null })).toThrow(/picture|price/i);
  });

  it("sends a price with an order button that joins the normal basket", () => {
    const message = promotionOutbound({
      text: "Half-price wings today",
      media: { mediaId: "mid" },
      priceCents: 4990,
      menuItemId: "item_wings",
    });
    expect(message.kind).toBe("buttons");
    if (message.kind !== "buttons") return;
    expect(message.body).toContain("Half-price wings today");
    expect(message.body).toContain("R49.90");
    expect(message.image).toEqual({ mediaId: "mid" });
    expect(message.buttons.map((button) => button.title)).toEqual(["Order this", "Browse the menu", "Type order"]);
    expect(decodeReplyId(message.buttons[0]?.id)).toEqual({ kind: "item", menuItemId: "item_wings" });
    expect(decodeReplyId(message.buttons[1]?.id)).toEqual({ kind: "categories" });

    const graph = toGraphMessage(message);
    const interactive = graph.interactive as { header: { type: string; image: { id: string } }; type: string };
    expect(interactive.type).toBe("button");
    expect(interactive.header).toEqual({ type: "image", image: { id: "mid" } });
  });

  it("reads a rand price and a kitchen name", () => {
    expect(parsePromoPrice("")).toBeNull();
    expect(parsePromoPrice("49.90")).toBe(4990);
    expect(parsePromoPrice("R12")).toBe(1200);
    expect(() => parsePromoPrice("nope")).toThrow(/price/i);
    expect(() => parsePromoPrice("-5")).toThrow(/negative/i);
    expect(promoItemName("Half-price wings today\nUntil 8")).toBe("Half-price wings today");
    expect(promoItemName("")).toBe("Today's special");
  });
});
