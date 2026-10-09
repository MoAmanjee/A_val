import { describe, expect, it } from "vitest";
import { classifyRecipient, promotionOutbound, SESSION_WINDOW_MS } from "@/services/promotions/broadcast";

describe("promotion audience", () => {
  const now = new Date("2026-10-09T10:00:00.000Z");

  it("keeps customers who messaged inside the last 24 hours", () => {
    expect(classifyRecipient(new Date(now.getTime() - 60 * 60 * 1000), now)).toBe("open");
    expect(classifyRecipient(new Date(now.getTime() - SESSION_WINDOW_MS + 1000), now)).toBe("open");
  });

  it("skips customers whose last message is older than 24 hours", () => {
    expect(classifyRecipient(new Date(now.getTime() - SESSION_WINDOW_MS), now)).toBe("closed");
    expect(classifyRecipient(new Date(now.getTime() - 3 * SESSION_WINDOW_MS), now)).toBe("closed");
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
    expect(() => promotionOutbound({ text: "   ", media: null })).toThrow(/picture/i);
  });
});
