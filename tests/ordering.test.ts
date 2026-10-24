import type { MenuItem, Store } from "@prisma/client";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MOCHACHOS_MENU } from "@/db/menu";
import { resolveStorePhoneId } from "@/db/seed";
import { addingSectionRows, categoryItemsMessage, categoryListRows, categoryPickerMessage, confirmationMessages, deliveryAddressMessage, deliveryNoteMessage, fulfilmentMessage, fulfilmentSummary, itemNotesMessage, keepAddingBody, mealUpgradeMessage, modifierQuestionMessage, orderActionsMessage, orderNotesMessage, orderProgressMessages, welcomeMessage } from "@/services/messaging/templates";
import { isSkippedDriverNote, parseDeliveryText, pinLabel } from "@/services/orders/delivery-text";
import { isSkippedItemNote } from "@/services/orders/item-notes";
import { DELIVERY_ENABLED, LEAN_ORDERING } from "@/services/orders/features";
import { parseWhatsAppWebhook } from "@/services/whatsapp/cloud";
import { catalogFromMenu, parseUtterance, sharedChoice, type ParsedLine } from "@/services/orders/dictate";
import { decodeReplyId, encodeReplyId } from "@/services/messaging/reply-ids";
import { clampDeliveryFeeCents, lineTotalCents, orderTotals } from "@/services/orders/pricing";
import { deliveryFeeLine } from "@/services/messaging/templates";
import { isReadyToConfirm, nextRequirement, orderNotesDone, type Requirement } from "@/services/orders/requirements";
import type { FullOrder, FullOrderItem, ItemModifierLink } from "@/services/orders/query";
import { toGraphMessage } from "@/services/whatsapp/cloud";
import { verifyWebhookSignature } from "@/services/whatsapp";
import { clamp, WA_LIMITS } from "@/services/whatsapp/limits";
import { isShopQuestion, matchFaq } from "@/services/conversations/faq";
import { interpretFaqReply } from "@/services/ai/faq-answer";
import { rankByName, scoreMatch } from "@/services/menu/matching";
import { isOwnOrderStatus, orderAsk } from "@/services/conversations/order-questions";
import { isGreeting, readAnythingElse, readConfirmation, wantsMenu, wantsMenuPictures } from "@/services/conversations/understanding";
import { menuPicturesDue } from "@/services/menu/images";
import { formatCents, parsePriceToCents } from "@/utils/money";

const store = {
  name: "Mochachos Potchefstroom CBD",
  tradingName: "Mochachos Potch CBD",
  city: "Potchefstroom",
  currencySymbol: "R",
  addressLine: "17 Nelson Mandela Dr",
  suburb: "CBD",
} as Store;

function itemByName(name: string) {
  for (const category of MOCHACHOS_MENU.categories) {
    const found = category.items.find((item) => item.name === name);
    if (found) return found;
  }
  throw new Error(`Missing menu item ${name}`);
}

describe("whatsapp phone number on the shop", () => {
  it("keeps one shop and prefers the id from the environment", () => {
    expect(resolveStorePhoneId({ fromEnv: "123456789012345", existing: "100000000000001" })).toBe("123456789012345");
    expect(resolveStorePhoneId({ existing: "123456789012345" })).toBe("123456789012345");
    expect(resolveStorePhoneId({})).toBe("100000000000001");
  });
});

describe("money", () => {
  it("formats cents the way the till prints them", () => {
    expect(formatCents(4990)).toBe("R49.90");
    expect(formatCents(100000)).toBe("R1 000.00");
    expect(parsePriceToCents("R89,90")).toBe(8990);
  });
});

describe("menu prices", () => {
  it("prices a meal the same as the matching combo", () => {
    const pairs: [string, string][] = [
      ["Chicken Burger", "Chicken Burger, Beeg Chips & Buddy"],
      ["1/4 Chicken", "1/4 Chicken, Beeg Chips & Buddy"],
      ["1/2 Chicken", "1/2 Chicken, Beeg Chips & Buddy"],
      ["Nacho Crunch Gourmet Burger", "Nacho Crunch Gourmet Burger, Beeg Chips & Buddy"],
    ];
    for (const [single, combo] of pairs) {
      const a = itemByName(single);
      const b = itemByName(combo);
      expect(a.priceCents + (a.mealUpgradeCents ?? 0)).toBe(b.priceCents);
    }
  });

  it("offers Zee Flavours including Dynamite", () => {
    const group = MOCHACHOS_MENU.modifierGroups.find((g) => g.name === "Zee Flavours");
    expect(group?.options.map((o) => o.name)).toEqual(["Lemon & Herb", "Mild", "Hot", "Extra Hot", "Dynamite"]);
  });
});

describe("pricing", () => {
  it("adds the meal and the chosen extras once each", () => {
    const line = lineTotalCents({
      unitPriceCents: 5990,
      quantity: 2,
      isMeal: true,
      mealUpgradeCents: 4000,
      modifierDeltaCents: [1000],
    });
    expect(line).toBe((5990 + 4000 + 1000) * 2);
    expect(orderTotals([{ unitPriceCents: 4990, quantity: 1, isMeal: false, mealUpgradeCents: 4600, modifierDeltaCents: [] }]).totalCents).toBe(4990);
  });

  it("adds the shop delivery price, and treats zero as free", () => {
    const food = [{ unitPriceCents: 9590, quantity: 1, isMeal: false, mealUpgradeCents: 0, modifierDeltaCents: [] }];
    expect(orderTotals(food, 2000).totalCents).toBe(11590);
    expect(orderTotals(food, 0).totalCents).toBe(9590);
    expect(clampDeliveryFeeCents(-500)).toBe(0);
    expect(clampDeliveryFeeCents(20_500)).toBe(20_000);
    expect(deliveryFeeLine(2000, store)).toBe("Delivery R20.00");
    expect(deliveryFeeLine(0, store)).toBe("Delivery free");
  });
});

describe("menu pictures", () => {
  const now = new Date("2026-10-09T10:00:00Z");

  it("sends the pages when a new order starts after the last one", () => {
    const sent = new Date("2026-10-09T09:40:00Z");
    const confirmed = new Date("2026-10-09T09:50:00Z");
    expect(menuPicturesDue({ lastSentAt: sent, lastConfirmedAt: confirmed, now })).toBe(true);
    expect(menuPicturesDue({ lastSentAt: null, lastConfirmedAt: null, now })).toBe(true);
  });

  it("does not send the pages again when they say hi twice before ordering", () => {
    const sent = new Date("2026-10-09T09:50:00Z");
    expect(menuPicturesDue({ lastSentAt: sent, lastConfirmedAt: null, now })).toBe(false);
    expect(menuPicturesDue({ lastSentAt: sent, lastConfirmedAt: new Date("2026-10-09T09:20:00Z"), now })).toBe(false);
  });
});

describe("confirmation words", () => {
  it("accepts South African yes and no", () => {
    for (const word of ["ja", "yebo", "sharp", "okay thanks", "👍"]) expect(readConfirmation(word)).toBe("yes");
    for (const word of ["nee", "nope", "ag no"]) expect(readConfirmation(word)).toBe("no");
  });

  it("refuses a yes that is also a change", () => {
    expect(readConfirmation("yes but make it hot")).toBe("unclear");
  });

  it("reads the end of an order", () => {
    expect(readAnythingElse("nope thats all")).toBe("done");
    expect(readAnythingElse("ja")).toBe("add");
    expect(isGreeting("howzit")).toBe(true);
    expect(isGreeting("goeie more")).toBe(true);
    expect(wantsMenuPictures("send me the menu pictures")).toBe(true);
    expect(wantsMenuPictures("quarter chicken hot")).toBe(false);
    expect(wantsMenu("menu please")).toBe(true);
    expect(wantsMenu("Menu")).toBe(true);
    expect(wantsMenu("hi")).toBe(false);
  });
});

describe("shop faqs", () => {
  const faqs = MOCHACHOS_MENU.faqs;

  it("answers shop questions and leaves orders alone", () => {
    expect(matchFaq("where are you?", faqs)?.question).toMatch(/Where are you/);
    expect(matchFaq("do you deliver", faqs)?.question).toMatch(/deliver/i);
    expect(matchFaq("how do I pay?", faqs)?.question).toMatch(/pay/i);
    expect(matchFaq("what are your hours?", faqs)?.question).toMatch(/hours/i);
    expect(matchFaq("how hot is dynamite?", faqs)?.question).toMatch(/Flavours/);
    expect(matchFaq("hi", faqs)).toBeNull();
    expect(matchFaq("menu please", faqs)).toBeNull();
    expect(matchFaq("hot quarter chicken and a coke", faqs)).toBeNull();
    expect(matchFaq("hot quarter chicken, deliver to 14 Kock Street", faqs)).toBeNull();
    expect(matchFaq("do you deliver?", faqs)?.answer).toMatch(/collection/i);
    expect(matchFaq("do you deliver?", faqs)?.answer).toMatch(/off for now|Not at the moment/);
    expect(matchFaq("how long does an order take?", faqs)?.question).toMatch(/How long/);
    expect(matchFaq("can I cancel my order?", faqs)?.question).toMatch(/cancel/i);
    expect(matchFaq("how much is delivery?", faqs)?.question).toMatch(/delivery/i);
    expect(matchFaq("what if I have a nut allergy?", faqs)?.question).toMatch(/allergy/i);
    expect(matchFaq("do you have kids meals?", faqs)?.question).toMatch(/kids/i);
    expect(matchFaq("where is my order?", faqs)?.question ?? "").not.toMatch(/park/i);
    expect(matchFaq("hot quarter chicken meal", faqs)).toBeNull();
    expect(matchFaq("how long are you open?", faqs)?.question).toMatch(/hours/i);
    expect(matchFaq("do you deliver outside Potchefstroom?", faqs)?.question).toMatch(/outside/i);
    expect(matchFaq("can I see the menu pictures?", faqs)?.question).toMatch(/see the menu/i);
    expect(matchFaq("what drinks can I choose?", faqs)?.question).toMatch(/drinks/i);
    expect(matchFaq("can each item have a different spice?", faqs)?.question).toMatch(/spice/i);
    expect(matchFaq("can I collect instead?", faqs)?.question).toMatch(/collect/i);
    expect(matchFaq("menu please", faqs)).toBeNull();
  });

  it("reads misspelled questions as the same shop answer", () => {
    expect(matchFaq("do you delivar?", faqs)?.question).toMatch(/deliver/i);
    expect(matchFaq("wat ar your ours?", faqs)?.question).toMatch(/hours/i);
    expect(matchFaq("i have a nut alergy", faqs)?.question).toMatch(/allergy/i);
    expect(matchFaq("do u have kidz meals?", faqs)?.question).toMatch(/kids/i);
    expect(matchFaq("where is my order?", faqs)?.question ?? "").not.toMatch(/park/i);
    expect(matchFaq("hot quarter chicken and a coke", faqs)).toBeNull();
    expect(isShopQuestion("do u delivar")).toBe(true);
    expect(isShopQuestion("hot quarter chicken")).toBe(false);
  });

  it("lets the model answer only from the written list", () => {
    expect(interpretFaqReply("UNKNOWN")).toEqual({ kind: "unknown" });
    expect(interpretFaqReply("ORDER")).toEqual({ kind: "order" });
    expect(interpretFaqReply("You collect from 17 Nelson Mandela Drive and pay at the till.")).toEqual({
      kind: "answer",
      text: "You collect from 17 Nelson Mandela Drive and pay at the till.",
    });
    expect(interpretFaqReply("  ")).toEqual({ kind: "unknown" });
  });

  it("matches a misspelled menu name and leaves a different word alone", () => {
    expect(scoreMatch("milkshak", "Milkshake")).toBeGreaterThanOrEqual(0.5);
    expect(scoreMatch("cake", "Coke")).toBe(0);
    const ranked = rankByName("burito", [{ name: "Burrito" }, { name: "Burger" }], (item) => item.name);
    expect(ranked[0]?.value.name).toBe("Burrito");
  });
});

describe("questions about an order", () => {
  it("treats how long my order takes as the live ticket, and opening hours as a shop question", () => {
    expect(orderAsk("how long is my order?")).toBe("status");
    expect(orderAsk("where is my order?")).toBe("status");
    expect(orderAsk("is it ready yet?")).toBe("status");
    expect(orderAsk("can I cancel?")).toBe("cancel");
    expect(orderAsk("can I change my order?")).toBe("change");
    expect(orderAsk("what's in my order?")).toBe("basket");
    expect(orderAsk("how long are you open?")).toBeNull();
    expect(orderAsk("quarter chicken hot")).toBeNull();
    expect(orderAsk("how long does an order take?")).toBe("status");
    expect(isOwnOrderStatus("where is my order?")).toBe(true);
    expect(isOwnOrderStatus("how long is my order?")).toBe(true);
    expect(isOwnOrderStatus("how long does an order take?")).toBe(false);
    expect(isOwnOrderStatus("how long are you open?")).toBe(false);
  });
});

describe("typed orders", () => {
  const catalog = catalogFromMenu(MOCHACHOS_MENU);

  function chosen(line: ParsedLine): string[] {
    return line.selections.flatMap((selection) => selection.optionIds.map((id) => id.split(":").at(-1) ?? id));
  }

  it("reads flavour, meal and drink from one message", () => {
    const parsed = parseUtterance("hot quarter chicken meal with a coke", catalog);
    expect(parsed.fulfilment).toBeNull();
    expect(parsed.deliveryAddress).toBeNull();
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].item.name).toBe("1/4 Chicken");
    expect(parsed.lines[0].isMeal).toBe(true);
    expect(chosen(parsed.lines[0])).toEqual(expect.arrayContaining(["Hot", "Coke"]));
    expect(chosen(parsed.lines[0])).not.toContain("Extra Hot");
  });

  it("reads two menu items from one message", () => {
    const parsed = parseUtterance("quarter chicken hot and a chicken burger mild", catalog);
    expect(parsed.lines.map((line) => line.item.name)).toEqual(["1/4 Chicken", "Chicken Burger"]);
    expect(chosen(parsed.lines[0])).toContain("Hot");
    expect(chosen(parsed.lines[1])).toContain("Mild");
  });

  it("reads a misspelled item instead of dropping it", () => {
    const parsed = parseUtterance("quarter chicken hot meal with a coke, burito hot, and a chicken burger mild", catalog);
    expect(parsed.lines.map((line) => line.item.name)).toEqual(["1/4 Chicken", "Burrito", "Chicken Burger"]);
    expect(parsed.unmatched).toEqual([]);
    expect(chosen(parsed.lines[0])).toEqual(expect.arrayContaining(["Hot", "Coke"]));
    expect(chosen(parsed.lines[2])).toContain("Mild");

    expect(parseUtterance("schwama hot", catalog).lines.map((line) => line.item.name)).toEqual(["Schwarma"]);
    expect(chosen(parseUtterance("schwama hot", catalog).lines[0])).toContain("Hot");
    expect(parseUtterance("burrto", catalog).lines[0]?.item.name).toBe("Burrito");
    expect(parseUtterance("chicken burito", catalog).lines.map((line) => line.item.name)).toEqual(["Burrito"]);
    expect(chosen(parseUtterance("chicken burito", catalog).lines[0])).toContain("Chicken");

    const missed = parseUtterance("a platter of mystery", catalog);
    expect(missed.lines).toHaveLength(0);
    expect(missed.unmatched.join(" ")).toMatch(/mystery|platter/i);
  });

  it("reads a loose menu name and the flavour word inside it", () => {
    expect(parseUtterance("nacho burger", catalog).lines[0]?.item.name).toBe("Nacho Crunch Gourmet Burger");
    expect(parseUtterance("jalapeno burger", catalog).lines[0]?.item.name).toBe("Jalapeno Cheese Burger");
    const shake = parseUtterance("milk shake strawbery", catalog);
    expect(shake.lines[0]?.item.name).toBe("Milkshake");
    expect(chosen(shake.lines[0])).toContain("Strawberry");
    const freezo = parseUtterance("freezo tofee", catalog);
    expect(freezo.lines[0]?.item.name).toBe("Freezo");
    expect(chosen(freezo.lines[0])).toContain("Toffee Caramel");
    const buddy = parseUtterance("buddy stoney", catalog);
    expect(buddy.lines[0]?.item.name).toBe("Buddy");
    expect(chosen(buddy.lines[0])).toContain("Stoney Ginger Beer");
    expect(parseUtterance("the usual", catalog).lines).toHaveLength(0);
    expect(parseUtterance("cappy", catalog).lines[0]?.item.name).toBe("330ml Cappy");
    expect(parseUtterance("cappi", catalog).lines[0]?.item.name).toBe("330ml Cappy");
    const appletiser = parseUtterance("appletiser", catalog);
    expect(appletiser.lines[0]?.item.name).toBe("Appletiser / Grapetiser");
    expect(chosen(appletiser.lines[0])).toContain("Appletiser");
    expect(parseUtterance("a can of coke", catalog).lines[0]?.item.name).toBe("Can");
    expect(chosen(parseUtterance("a can of coke", catalog).lines[0]!)).toContain("Coke");
    const grape = parseUtterance("grapetiser", catalog);
    expect(grape.lines[0]?.item.name).toBe("Appletiser / Grapetiser");
    expect(chosen(grape.lines[0])).toContain("Grapetiser");
    expect(parseUtterance("ice tea lemon", catalog).lines[0]?.item.name).toBe("Lemon Ice Tea");
    expect(parseUtterance("cake", catalog).lines).toHaveLength(0);
    const jose = parseUtterance("jose", catalog);
    expect(jose.lines[0]?.item.name).toBe("Bambino Meal");
    expect(chosen(jose.lines[0])).toContain("Jose");
    expect(parseUtterance("4 wings", catalog).lines[0]?.item.name).toBe("4 Full BBQ Wings");
    expect(parseUtterance("8 wings", catalog).lines[0]?.item.name).toBe("8 Full BBQ Wings & Beeger Chips");
  });

  it("keeps a leave-out on the item instead of calling it a missed dish", () => {
    const parsed = parseUtterance("chicken burger hot, no tomato", catalog);
    expect(parsed.unmatched).toEqual([]);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].item.name).toBe("Chicken Burger");
    expect(chosen(parsed.lines[0])).toContain("Hot");
    expect(parsed.lines[0].notes).toBe("no tomato");

    const inline = parseUtterance("burrito with no tomato and no lettuce", catalog);
    expect(inline.unmatched).toEqual([]);
    expect(inline.lines[0]?.item.name).toBe("Burrito");
    expect(inline.lines[0]?.notes).toMatch(/no tomato/);
    expect(inline.lines[0]?.notes).toMatch(/no lettuce/);

    const meal = parseUtterance("quarter chicken no meal", catalog);
    expect(meal.lines[0]?.item.name).toBe("1/4 Chicken");
    expect(meal.lines[0]?.isMeal).toBe(false);
    expect(meal.lines[0]?.notes).toBeNull();
  });

  it("asks which burger when the words fit more than one", () => {
    const parsed = parseUtterance("cheese burger", catalog);
    expect(parsed.lines).toHaveLength(0);
    expect(parsed.ambiguous[0]?.names).toEqual(
      expect.arrayContaining(["Chicken Cheese Burger", "Jalapeno Cheese Burger"]),
    );
    expect(parseUtterance("beef burger", catalog).lines[0]?.item.name).toBe("Beef Burger");
  });

  it("does not treat the 1.5 litre size as a quantity", () => {
    const one = parseUtterance("1.5 litre coke", catalog);
    expect(one.lines[0]?.item.name).toBe("1.5 Litre");
    expect(one.lines[0]?.quantity).toBe(1);
    expect(chosen(one.lines[0])).toContain("Coke");
    const two = parseUtterance("2 1.5 litre cokes", catalog);
    expect(two.lines[0]?.item.name).toBe("1.5 Litre");
    expect(two.lines[0]?.quantity).toBe(2);
    expect(chosen(two.lines[0])).toContain("Coke");
  });

  it("reads a pasted list with x quantities, beeg chips and shawarmas", () => {
    const pasted = parseUtterance("1 x Chicken burger\n2 x beeg chips\n2x shawarmas", catalog);
    expect(pasted.unmatched).toEqual([]);
    expect(pasted.lines.map((line) => ({ name: line.item.name, qty: line.quantity }))).toEqual([
      { name: "Chicken Burger", qty: 1 },
      { name: "Chips", qty: 2 },
      { name: "Schwarma", qty: 2 },
    ]);
    expect(chosen(pasted.lines[1])).toContain("Beeg");

    const slash = parseUtterance("1 x Chicken burger / 2 x beeg chips / 2x shawarmas", catalog);
    expect(slash.lines.map((line) => ({ name: line.item.name, qty: line.quantity }))).toEqual([
      { name: "Chicken Burger", qty: 1 },
      { name: "Chips", qty: 2 },
      { name: "Schwarma", qty: 2 },
    ]);
  });

  it("keeps quantities on a large multi-line order over R1000", () => {
    const parsed = parseUtterance(
      [
        "4 x chicken burger meal",
        "3 x quarter chicken meal",
        "2 x chicken burrito hot",
        "5 x schwarma",
        "3 x beeg chips",
        "2 x loaded chips",
        "4 x buddy coke",
        "2 x nacho crunch gourmet burger",
        "3 x 1/2 chicken",
      ].join("\n"),
      catalog,
    );
    expect(parsed.unmatched).toEqual([]);
    expect(parsed.lines.map((line) => ({ name: line.item.name, qty: line.quantity }))).toEqual([
      { name: "Chicken Burger", qty: 4 },
      { name: "1/4 Chicken", qty: 3 },
      { name: "Burrito", qty: 2 },
      { name: "Schwarma", qty: 5 },
      { name: "Chips", qty: 3 },
      { name: "Loaded Chips", qty: 2 },
      { name: "Buddy", qty: 4 },
      { name: "Nacho Crunch Gourmet Burger", qty: 2 },
      { name: "1/2 Chicken", qty: 3 },
    ]);
    expect(parsed.lines[0]?.isMeal).toBe(true);
    expect(parsed.lines[1]?.isMeal).toBe(true);
    expect(chosen(parsed.lines[2])).toContain("Chicken");
    expect(chosen(parsed.lines[4])).toContain("Beeg");
    expect(chosen(parsed.lines[6])).toContain("Coke");

    const byName = new Map(
      MOCHACHOS_MENU.categories.flatMap((category) => category.items.map((item) => [item.name, item] as const)),
    );
    let totalCents = 0;
    for (const line of parsed.lines) {
      const item = byName.get(line.item.name);
      expect(item, line.item.name).toBeTruthy();
      const meal = line.isMeal ? (item!.mealUpgradeCents ?? 0) : 0;
      totalCents += (item!.priceCents + meal) * line.quantity;
    }
    expect(totalCents).toBeGreaterThan(100_000);
  });

  it("uses one spice for every item when the customer says all hot", () => {
    const parsed = parseUtterance("quarter chicken and a chicken burger all hot", catalog);
    expect(sharedChoice("quarter chicken and a chicken burger all hot", catalog)).toEqual({ groupId: "Zee Flavours", optionName: "Hot" });
    expect(parsed.lines.map((line) => line.item.name)).toEqual(["1/4 Chicken", "Chicken Burger"]);
    expect(chosen(parsed.lines[0])).toContain("Hot");
    expect(chosen(parsed.lines[0])).not.toContain("Extra Hot");
    expect(chosen(parsed.lines[1])).toContain("Hot");
  });

  it("does not overwrite a spice that was named on its own item", () => {
    const parsed = parseUtterance("quarter chicken hot and a chicken burger all mild", catalog);
    expect(chosen(parsed.lines[0])).toContain("Hot");
    expect(chosen(parsed.lines[0])).not.toContain("Mild");
    expect(chosen(parsed.lines[1])).toContain("Mild");
  });

  it("does not treat extra hot as hot", () => {
    const parsed = parseUtterance("extra hot quarter chicken", catalog);
    expect(parsed.lines[0].item.name).toBe("1/4 Chicken");
    expect(chosen(parsed.lines[0])).toContain("Extra Hot");
    expect(chosen(parsed.lines[0])).not.toContain("Hot");
    expect(parsed.lines[0].isMeal).toBeNull();
  });

  it("keeps a drink on the meal instead of adding a can", () => {
    const parsed = parseUtterance("hot quarter chicken and a coke", catalog);
    expect(parsed.lines.map((line) => line.item.name)).toEqual(["1/4 Chicken"]);
    expect(parsed.lines[0].isMeal).toBe(true);
    expect(chosen(parsed.lines[0])).toEqual(expect.arrayContaining(["Hot", "Coke"]));
  });

  it("reads collection and a delivery address", () => {
    const collect = parseUtterance("quarter chicken, collect", catalog);
    expect(collect.lines[0].item.name).toBe("1/4 Chicken");
    expect(collect.fulfilment).toBe("COLLECTION");
    expect(collect.deliveryAddress).toBeNull();

    const delivery = parseUtterance("delivery to 14 Kock Street", catalog);
    expect(delivery.lines).toHaveLength(0);
    expect(delivery.fulfilment).toBe("DELIVERY");
    expect(delivery.deliveryAddress).toBe("14 Kock Street");

    const together = parseUtterance("hot quarter chicken meal with a coke, delivery to 14 Kock Street", catalog);
    expect(together.lines[0].item.name).toBe("1/4 Chicken");
    expect(together.lines[0].isMeal).toBe(true);
    expect(chosen(together.lines[0])).toEqual(expect.arrayContaining(["Hot", "Coke"]));
    expect(together.fulfilment).toBe("DELIVERY");
    expect(together.deliveryAddress).toBe("14 Kock Street");
  });

  it("leaves a delivery question for the FAQ", () => {
    for (const text of [
      "do you deliver?",
      "how much is delivery?",
      "how long does an order take?",
      "can I cancel my order?",
      "what if I have a nut allergy?",
    ]) {
      const parsed = parseUtterance(text, catalog);
      expect(parsed.ignoredAsQuestion, text).toBe(true);
      expect(parsed.lines, text).toHaveLength(0);
    }
  });

  it("still hears a kids meal as an order", () => {
    const parsed = parseUtterance("can I get a bambino meal", catalog);
    expect(parsed.ignoredAsQuestion).toBe(false);
    expect(parsed.lines[0]?.item.name).toBe("Bambino Meal");
  });

  it("prints delivery on the order summary", () => {
    const line = fulfilmentSummary({ fulfilment: "DELIVERY", deliveryAddress: "14 Kock Street" }, store);
    expect(line).toBe("Delivery to 14 Kock Street");
    expect(fulfilmentSummary({ fulfilment: "COLLECTION" }, store)).toMatch(/Collection from 17 Nelson Mandela Dr/);
  });
});

describe("reply ids", () => {
  it("round-trips every button the bot sends", () => {
    const actions = [
      { kind: "category" as const, categoryId: "cat_1", page: 2 },
      { kind: "categories" as const },
      { kind: "categories" as const, page: 1 },
      { kind: "menuPhotos" as const },
      { kind: "typeOrder" as const },
      { kind: "item" as const, menuItemId: "item_1" },
      { kind: "modifier" as const, orderItemId: "line_1", optionId: "opt_1" },
      { kind: "meal" as const, orderItemId: "line_1", yes: false },
      { kind: "anythingElse" as const, done: true },
      { kind: "fulfilment" as const, mode: "DELIVERY" as const },
      { kind: "confirm" as const, answer: "yes" as const },
      { kind: "cancelOrder" as const, yes: true },
      { kind: "human" as const },
    ];
    for (const action of actions) {
      expect(decodeReplyId(encodeReplyId(action))).toEqual(action.kind === "category" ? action : action);
    }
    expect(decodeReplyId("cat:cat_1")).toEqual({ kind: "category", categoryId: "cat_1", page: 0 });
    expect(decodeReplyId("nope")).toBeNull();
  });
});

describe("whatsapp messages", () => {
  it("sends images and documents instead of falling through to a list", () => {
    const image = toGraphMessage({ kind: "image", media: { mediaId: "mid" }, caption: "Page 1" });
    expect(image).toMatchObject({ type: "image", image: { id: "mid", caption: "Page 1" } });
    const doc = toGraphMessage({ kind: "document", media: { link: "https://example.com/menu.pdf" }, filename: "Mochachos-Menu.pdf" });
    expect(doc).toMatchObject({ type: "document", document: { link: "https://example.com/menu.pdf", filename: "Mochachos-Menu.pdf" } });
  });

  it("verifies the webhook signature", () => {
    const body = '{"ok":true}';
    const sig = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, sig, "secret")).toBe(true);
    expect(verifyWebhookSignature(body, sig, "other")).toBe(false);
    expect(verifyWebhookSignature(body, null, "secret")).toBe(false);
  });

  it("pages a long category and keeps every list inside Meta's row cap", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `item-${i}`,
      name: `Burger number ${i + 1} with a very long board name`,
      shortName: `Burger ${i + 1}`,
      description: null,
      priceCents: 5990,
      mealUpgradeCents: null,
      available: true,
      soldOutNote: null,
    })) as unknown as Pick<MenuItem, "id" | "name" | "shortName" | "description" | "priceCents" | "mealUpgradeCents" | "available" | "soldOutNote">[];

    const first = categoryItemsMessage(store, { id: "burgers", name: "Burger El' Supremo", description: null }, items, 0);
    expect(first.kind).toBe("list");
    if (first.kind !== "list") return;
    const titles = first.sections.flatMap((s) => s.rows.map((r) => r.title));
    expect(titles).toContain("More items");
    expect(titles).toContain("← Back to menu");
    expect(first.sections.flatMap((s) => s.rows).length).toBeLessThanOrEqual(WA_LIMITS.maxListRows);
    expect(titles.filter((t) => t.startsWith("Burger")).length).toBe(8);

    const more = decodeReplyId(first.sections[0].rows.find((r) => r.title === "More items")?.id);
    expect(more).toMatchObject({ kind: "category", categoryId: "burgers", page: 1 });

    const second = categoryItemsMessage(store, { id: "burgers", name: "Burger El' Supremo", description: null }, items, 1);
    if (second.kind !== "list") throw new Error("expected a list");
    const secondTitles = second.sections.flatMap((s) => s.rows.map((r) => r.title));
    expect(secondTitles).toEqual(["Burger 9", "Burger 10", "Burger 11", "Burger 12", "← Back to menu"]);
  });

  it("opens the photo menu with a CTA URL on greeting", () => {
    const message = welcomeMessage(store, "Thabo", { orderUrl: "https://example.com/order" });
    expect(message.kind).toBe("cta_url");
    if (message.kind !== "cta_url") return;
    expect(message.buttonText).toBe("Order online");
    expect(message.url).toBe("https://example.com/order");
    expect(message.buttonText.length).toBeLessThanOrEqual(WA_LIMITS.ctaUrlButton);
    const graph = toGraphMessage(message);
    expect(graph).toMatchObject({
      type: "interactive",
      interactive: {
        type: "cta_url",
        action: {
          name: "cta_url",
          parameters: { display_text: "Order online", url: "https://example.com/order" },
        },
      },
    });
  });

  it("puts menu pictures on the category list without exceeding 10 rows", () => {
    const categories = MOCHACHOS_MENU.categories.map((c, i) => ({ id: `c${i}`, name: c.name, description: c.description ?? null }));
    const rows = categoryListRows(categories);
    expect(rows[0].title).toBe("Menu pictures");
    expect(rows.length).toBeLessThanOrEqual(WA_LIMITS.maxListRows);
    expect(rows.some((r) => r.title.startsWith("Burger"))).toBe(true);
  });

  it("keeps the next item on the list and puts collect at the bottom", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `item-${i}`,
      name: `Burger ${i + 1}`,
      shortName: `Burger ${i + 1}`,
      description: null,
      priceCents: 5990,
      mealUpgradeCents: null,
      available: true,
      soldOutNote: null,
    })) as unknown as Pick<MenuItem, "id" | "name" | "shortName" | "description" | "priceCents" | "mealUpgradeCents" | "available" | "soldOutNote">[];

    const list = categoryItemsMessage(store, { id: "burgers", name: "Burger El' Supremo", description: null }, items, 0, {
      adding: true,
      buttonLabel: "Next item",
    });
    if (list.kind !== "list") throw new Error("expected a list");
    const rows = list.sections.flatMap((section) => section.rows);
    expect(rows.length).toBeLessThanOrEqual(WA_LIMITS.maxListRows);
    expect(rows[0]?.title).toBe("Burger 1");
    expect(rows.map((row) => row.title)).not.toContain("That's everything");
    expect(rows.map((row) => row.title)).not.toContain("Collect");
    expect(rows.map((row) => row.title)).toContain("Other sections");
    expect(list.buttonLabel).toBe("Next item");

    const categories = MOCHACHOS_MENU.categories.map((c, i) => ({ id: `c${i}`, name: c.name, description: c.description ?? null }));
    const sectionRows = addingSectionRows(categories);
    expect(sectionRows.length).toBeLessThanOrEqual(WA_LIMITS.maxListRows);
    expect(sectionRows[0]?.title).not.toBe("Collect");
    expect(sectionRows.at(-1)?.title).toBe("Back to my order");
    expect(decodeReplyId(sectionRows.at(-1)?.id)).toEqual({ kind: "basket" });
    expect(sectionRows.some((row) => row.title.startsWith("Burger"))).toBe(true);
    expect(sectionRows.some((row) => row.title.startsWith("Pollo"))).toBe(true);
    const pageTwo = addingSectionRows(categories, 1);
    expect(pageTwo.length).toBeLessThanOrEqual(WA_LIMITS.maxListRows);
    expect(pageTwo.at(-1)?.title).toBe("Back to my order");

    const picker = categoryPickerMessage(store, categories, "So far:\n• 1/4 Chicken\n\n*Total: R95.90*", { checkout: true });
    if (picker.kind !== "list") throw new Error("expected a list");
    expect(picker.buttonLabel).toBe("Add to order");
    expect((picker.footer ?? "").length).toBeLessThanOrEqual(WA_LIMITS.footerText);
    const pickerRows = picker.sections.flatMap((section) => section.rows);
    expect(pickerRows[0]?.title).not.toBe("Collect");
    expect(pickerRows.at(-1)?.title).toBe("Back to my order");
    expect(pickerRows.some((row) => row.title.startsWith("Burger"))).toBe(true);
  });

  it("fits a running total into one WhatsApp list body", () => {
    const order = {
      totalCents: 19180,
      items: [
        { quantity: 1, nameSnapshot: "1/4 Chicken", modifiers: [], menuItem: { modifierLinks: [] }, isMeal: true, notes: null },
        { quantity: 1, nameSnapshot: "Chicken Burger", modifiers: [], menuItem: { modifierLinks: [] }, isMeal: false, notes: null },
      ],
    } as unknown as Parameters<typeof keepAddingBody>[0];
    const body = keepAddingBody(order, store);
    expect(body).toContain("1/4 Chicken");
    expect(body).toContain("Chicken Burger");
    expect(body).not.toMatch(/That's everything/);
    expect(body.length).toBeLessThanOrEqual(WA_LIMITS.interactiveBody);

    const actions = orderActionsMessage(order, store);
    if (actions.kind === "buttons") expect(actions.body).toContain("Chicken Burger");
    expect(actions.kind).toBe("buttons");
    if (actions.kind !== "buttons") return;
    expect(actions.buttons.map((button) => button.title)).toEqual(["Place order", "Add to order", "Cancel order"]);
    expect(actions.buttons.every((button) => button.title.length <= WA_LIMITS.buttonTitle)).toBe(true);
    expect(decodeReplyId(actions.buttons[0]?.id)).toEqual({ kind: "anythingElse", done: true });
    expect(decodeReplyId(actions.buttons[1]?.id)).toEqual({ kind: "anythingElse", done: false });
    expect(decodeReplyId(actions.buttons[2]?.id)).toEqual({ kind: "confirm", answer: "cancel" });

    const delivery = fulfilmentMessage({ ...store, deliveryFeeCents: 1500 } as Store);
    expect(delivery.kind).toBe("buttons");
    if (delivery.kind === "buttons") {
      expect(delivery.body).toContain("Would you like delivery?");
      expect(delivery.body).toContain("R15.00");
      expect(delivery.buttons.map((button) => button.title)).toEqual(["Yes, deliver", "I'll collect"]);
    }
  });

  it("sends a long basket as text so the list is not cut off", () => {
    const items = Array.from({ length: 14 }, (_, index) => ({
      quantity: 1,
      nameSnapshot: `Chicken Schwarma Burger ${index + 1}`,
      modifiers: [{ groupNameSnapshot: "Zee Flavours", optionNameSnapshot: "Extra Hot and a Buddy with Creme Soda" }],
      menuItem: { modifierLinks: [] },
      isMeal: true,
      notes: null,
    }));
    const order = { totalCents: 88710, items } as unknown as Parameters<typeof orderProgressMessages>[0];
    const messages = orderProgressMessages(order, store);
    const text = messages.find((message) => message.kind === "text");
    const buttons = messages.find((message) => message.kind === "buttons");
    expect(text?.kind).toBe("text");
    expect(buttons?.kind).toBe("buttons");
    if (text?.kind !== "text" || buttons?.kind !== "buttons") return;
    expect(text.text).toContain("Chicken Schwarma Burger 1");
    expect(text.text).toContain("Chicken Schwarma Burger 14");
    expect(text.text.length).toBeLessThanOrEqual(WA_LIMITS.textBody);
    expect(buttons.body.length).toBeLessThanOrEqual(WA_LIMITS.interactiveBody);
    expect(buttons.body).toContain("14 items");
    expect(buttons.body).not.toContain("Chicken Schwarma Burger 1");
  });

  it("splits a huge confirmation receipt instead of cutting items off", () => {
    const items = Array.from({ length: 80 }, (_, index) => ({
      quantity: 2,
      nameSnapshot: `Office Party Platter Line ${index + 1} with Extra Hot and Buddy`,
      lineTotalCents: 12_990,
      modifiers: [{ groupNameSnapshot: "Zee Flavours", optionNameSnapshot: "Extra Hot" }],
      menuItem: { modifierLinks: [] },
      isMeal: true,
      notes: index % 3 === 0 ? "no tomato" : null,
    }));
    const order = {
      totalCents: 1_039_200,
      fulfilment: "COLLECTION",
      items,
      notes: null,
      deliveryFeeCents: 0,
      deliveryAddress: null,
      deliveryNotes: null,
    } as unknown as Parameters<typeof confirmationMessages>[0];
    const messages = confirmationMessages(order, store, 25);
    const texts = messages.filter((message) => message.kind === "text");
    const buttons = messages.find((message) => message.kind === "buttons");
    expect(texts.length).toBeGreaterThan(1);
    expect(buttons?.kind).toBe("buttons");
    const joined = texts.map((message) => (message.kind === "text" ? message.text : "")).join("\n");
    expect(joined).toContain("Office Party Platter Line 1");
    expect(joined).toContain("Office Party Platter Line 80");
    expect(joined).toContain("R10 392.00");
    for (const message of texts) {
      if (message.kind === "text") expect(message.text.length).toBeLessThanOrEqual(WA_LIMITS.textBody);
    }
    if (buttons?.kind === "buttons") {
      expect(buttons.body.length).toBeLessThanOrEqual(WA_LIMITS.interactiveBody);
      expect(buttons.buttons.map((button) => button.title)).toEqual(["Accept", "Decline"]);
    }
  });

  it("breaks a cut-off menu row on a word", () => {
    const full = "R129.90 · Two soft flour tortillas to wrap your filling, with Mexican rice and salsa";
    const description = clamp(full, WA_LIMITS.rowDescription);
    expect(description.length).toBeLessThanOrEqual(WA_LIMITS.rowDescription);
    expect(description.endsWith("\u2026")).toBe(true);
    expect(full.startsWith(description.slice(0, -1).trimEnd())).toBe(true);
    expect(description).not.toMatch(/Mexican r/);
  });
});

function choiceQuestion(groupName: string, prompt: string, options: { name: string; description?: string }[]) {
  const link = {
    required: true,
    modifierGroupId: "g",
    scope: "ALWAYS",
    group: {
      id: "g",
      name: groupName,
      prompt,
      selection: "SINGLE",
      options: options.map((option, index) => ({
        id: `o${index}`,
        name: option.name,
        description: option.description ?? null,
        available: true,
        priceDeltaCents: 0,
      })),
    },
  } as unknown as ItemModifierLink;
  const item = {
    id: "line",
    nameSnapshot: "Buddy",
    modifiers: [],
    menuItem: { modifierLinks: [link] },
  } as unknown as FullOrderItem;
  return modifierQuestionMessage({ items: [item] } as FullOrder, item, link, store);
}

describe("choice labels", () => {
  it("asks for a drink on a cool drink, a can, and a buddy", () => {
    const drinks = ["Coke", "Coke Zero", "Fanta Orange", "Sprite", "Creme Soda", "Stoney Ginger Beer"].map((name) => ({ name }));
    const message = choiceQuestion("Soft drink flavour", "Which cold drink would you like?", drinks);
    expect(message.kind).toBe("list");
    if (message.kind !== "list") return;
    expect(message.buttonLabel).toBe("Choose a drink");
    expect(message.buttonLabel).not.toBe("Choose spice");
  });

  it("asks for a flavour on a milkshake, and spice only for Zee Flavours", () => {
    const shake = choiceQuestion("Milkshake flavour", "Which milkshake flavour?", [
      { name: "Chocolate" },
      { name: "Strawberry" },
      { name: "Banana" },
      { name: "Bubblegum" },
      { name: "Lime" },
    ]);
    expect(shake.kind).toBe("list");
    if (shake.kind === "list") expect(shake.buttonLabel).toBe("Choose flavour");

    const spice = choiceQuestion("Zee Flavours", "Which of Zee Flavours would you like?", [
      { name: "Lemon & Herb" },
      { name: "Mild" },
      { name: "Hot" },
      { name: "Extra Hot" },
      { name: "Dynamite" },
    ]);
    expect(spice.kind).toBe("list");
    if (spice.kind === "list") expect(spice.buttonLabel).toBe("Choose spice");

    for (const [groupName, label] of [
      ["Appletiser choice", "Choose a drink"],
      ["Water type", "Choose a drink"],
      ["Loaded chips size", "Choose a size"],
      ["Mexican filling", "Choose filling"],
      ["Mochachos sauce", "Choose a sauce"],
      ["Churros dip", "Choose a dip"],
      ["Family chips choice", "Choose a side"],
    ] as const) {
      const message = choiceQuestion(groupName, "Which one?", [
        { name: "One" },
        { name: "Two" },
        { name: "Three" },
        { name: "Four" },
      ]);
      expect(message.kind, groupName).toBe("list");
      if (message.kind === "list") {
        expect(message.buttonLabel, groupName).toBe(label);
        expect(message.buttonLabel.length, groupName).toBeLessThanOrEqual(20);
      }
    }
  });

  it("keeps a long extra name whole and puts the price in the row description", () => {
    const message = modifierQuestionMessage(
      { items: [] } as unknown as FullOrder,
      { id: "line", nameSnapshot: "Burger", modifiers: [], menuItem: { modifierLinks: [] } } as unknown as FullOrderItem,
      {
        required: false,
        modifierGroupId: "ex",
        scope: "ALWAYS",
        group: {
          id: "ex",
          name: "Extras",
          prompt: "Add anything?",
          selection: "MULTIPLE",
          options: [
            { id: "pine", name: "Slice of pineapple", description: null, available: true, priceDeltaCents: 1000 },
            { id: "cheese", name: "Slice of cheese", description: null, available: true, priceDeltaCents: 1000 },
          ],
        },
      } as unknown as ItemModifierLink,
      store,
    );
    expect(message.kind).toBe("list");
    if (message.kind !== "list") return;
    const titles = message.sections.flatMap((section) => section.rows.map((row) => row.title));
    expect(titles).toContain("Slice of pineapple");
    expect(titles).toContain("Slice of cheese");
    for (const row of message.sections.flatMap((section) => section.rows)) {
      expect(row.title.length).toBeLessThanOrEqual(WA_LIMITS.rowTitle);
      if (row.title.startsWith("Slice of")) expect(row.description).toMatch(/\+R10\.00/);
    }
  });

  it("shows the kids meal descriptions with the names", () => {
    const message = choiceQuestion("Bambino choice", "Which Bambino meal would you like?", [
      { name: "Jose", description: "Mini chicken fillet burger" },
      { name: "Pedro", description: "Mini beef burger" },
      { name: "Speedy", description: "4 battered chicken breast strips" },
    ]);
    expect(message.kind).toBe("buttons");
    if (message.kind !== "buttons") return;
    expect(message.body).toContain("Jose — Mini chicken fillet burger");
    expect(message.body).toContain("Pedro — Mini beef burger");
    expect(message.body).toContain("Speedy — 4 battered chicken breast strips");
    expect(message.buttons.map((button) => button.title)).toEqual(["Jose", "Pedro", "Speedy"]);
  });
});

describe("what an order still needs", () => {
  function link(scope: "ALWAYS" | "MEAL_ONLY", groupId: string, names: string[]): ItemModifierLink {
    return {
      scope,
      required: true,
      modifierGroupId: groupId,
      group: { id: groupId, name: groupId, options: names.map((name) => ({ name, available: true })) },
    } as unknown as ItemModifierLink;
  }

  function line(partial: Partial<FullOrderItem> & { links: ItemModifierLink[]; chosen?: string[] }): FullOrderItem {
    return {
      id: "line",
      nameSnapshot: "1/4 Chicken",
      isMeal: null,
      modifiers: (partial.chosen ?? []).map((groupId) => ({ groupId })),
      menuItem: { modifierLinks: partial.links, mealDescription: "beeg chips and a buddy drink", mealUpgradeCents: 4600 },
      ...partial,
    } as unknown as FullOrderItem;
  }

  it("asks flavour, then the meal, then the drink", () => {
    const flavour = link("ALWAYS", "flavour", ["Hot"]);
    const drink = link("MEAL_ONLY", "drink", ["Coke"]);
    const order = { items: [line({ links: [flavour, drink] })] } as FullOrder;

    expect(nextRequirement(order)?.kind).toBe("MODIFIER");
    order.items[0].modifiers = [{ groupId: "flavour" } as FullOrderItem["modifiers"][number]];
    const meal = nextRequirement(order);
    expect(meal?.kind).toBe("MEAL_UPGRADE");

    order.items[0].isMeal = true;
    const drinkReq = nextRequirement(order) as Requirement;
    expect(drinkReq.kind).toBe("MODIFIER");
    if (drinkReq.kind === "MODIFIER") expect(drinkReq.link.modifierGroupId).toBe("drink");

    order.items[0].modifiers.push({ groupId: "drink" } as FullOrderItem["modifiers"][number]);
    // Lean mode skips per-item notes; the whole-order note is asked at Place order.
    expect(nextRequirement(order)).toBeNull();
    expect(orderNotesDone(order)).toBe(false);
    order.items[0].notesOffered = true;
    expect(orderNotesDone(order)).toBe(true);
    expect(isReadyToConfirm(order)).toBe(true);
  });

  it("does not ask for a meal drink when the customer said no", () => {
    const order = {
      items: [line({ links: [link("ALWAYS", "flavour", ["Hot"]), link("MEAL_ONLY", "drink", ["Coke"])], chosen: ["flavour"], isMeal: false, notesOffered: true })],
    } as FullOrder;
    expect(nextRequirement(order)).toBeNull();
  });

  it("tells the customer what the meal includes", () => {
    const item = line({ links: [] });
    const message = mealUpgradeMessage({ items: [item] } as FullOrder, item, store);
    expect(message.kind).toBe("buttons");
    if (message.kind === "buttons") expect(message.body).toContain("beeg chips and a buddy drink");
  });

  it("asks one kitchen note for the whole order in lean mode", () => {
    expect(LEAN_ORDERING).toBe(true);
    const order = {
      items: [line({ links: [link("ALWAYS", "flavour", ["Hot"])], chosen: ["flavour"], isMeal: false, nameSnapshot: "Beef Burger" })],
    } as FullOrder;
    expect(nextRequirement(order)).toBeNull();
    expect(orderNotesDone(order)).toBe(false);

    const message = orderNotesMessage(order);
    expect(message.kind).toBe("buttons");
    if (message.kind !== "buttons") return;
    expect(message.body).toContain("kitchen");
    expect(message.body).toContain("no tomato");
    expect(message.buttons[0]?.title).toBe("No notes");
    expect(decodeReplyId(message.buttons[0]?.id)).toEqual({ kind: "orderNote", skip: true });

    const withPrior = orderNotesMessage({ ...order, notes: "no tomato on the burger" } as FullOrder);
    expect(withPrior.kind).toBe("buttons");
    if (withPrior.kind === "buttons") expect(withPrior.body).toContain("no tomato on the burger");

    // Per-item note copy still works if LEAN_ORDERING is turned off later.
    const chosen = line({
      links: [],
      nameSnapshot: "Milkshake",
      modifiers: [{ groupNameSnapshot: "Milkshake flavour", optionNameSnapshot: "Strawberry" } as FullOrderItem["modifiers"][number]],
    });
    const named = itemNotesMessage(chosen);
    expect(named.kind).toBe("buttons");
    if (named.kind === "buttons") {
      expect(named.body).toContain("Milkshake (Strawberry)");
      expect(named.body).not.toContain("Lime");
    }
    expect(isSkippedItemNote("no")).toBe(true);
    expect(isSkippedItemNote("No notes")).toBe(true);
    expect(isSkippedItemNote("no tomato")).toBe(false);
    expect(isSkippedItemNote("no lettuce")).toBe(false);
    expect(DELIVERY_ENABLED).toBe(false);
  });
});

describe("delivery address and pin", () => {
  it("keeps a typed street, and a driver note on the next line or after note:", () => {
    expect(parseDeliveryText("14 Kock Street")).toEqual({ address: "14 Kock Street", notes: null });
    expect(parseDeliveryText("14 Kock Street\nGate code 1234")).toEqual({
      address: "14 Kock Street",
      notes: "Gate code 1234",
    });
    expect(parseDeliveryText("17 Nelson Mandela Dr note: blue gate")).toEqual({
      address: "17 Nelson Mandela Dr",
      notes: "blue gate",
    });
    expect(parseDeliveryText("hi")).toBeNull();
    expect(parseDeliveryText("where is my order")).toBeNull();
    expect(parseDeliveryText("do you deliver to Cachet")).toBeNull();
  });

  it("treats no, skip and nothing as an empty driver note", () => {
    expect(isSkippedDriverNote("no")).toBe(true);
    expect(isSkippedDriverNote("No note")).toBe(true);
    expect(isSkippedDriverNote("nothing")).toBe(true);
    expect(isSkippedDriverNote("skip please")).toBe(true);
    expect(isSkippedDriverNote("park at the blue gate")).toBe(false);
    expect(isSkippedDriverNote("nothing, just hoot")).toBe(false);
  });

  it("labels a WhatsApp pin and puts the coordinates on the kitchen map link", () => {
    expect(pinLabel({ latitude: -26.71452, longitude: 27.09705 })).toBe("Pinned location (-26.71452, 27.09705)");
    expect(pinLabel({ latitude: -26.7, longitude: 27.1, name: "Mochachos", address: "17 Nelson Mandela Dr" })).toBe(
      "Mochachos, 17 Nelson Mandela Dr",
    );

    const parsed = parseWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "1261244360400536" },
                messages: [
                  {
                    id: "wamid.pin",
                    from: "27821234567",
                    timestamp: "1710000000",
                    type: "location",
                    location: { latitude: -26.71452, longitude: 27.09705, name: "Home", address: "14 Kock Street" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(parsed.messages[0]?.location).toEqual({
      latitude: -26.71452,
      longitude: 27.09705,
      name: "Home",
      address: "14 Kock Street",
    });
    expect(parsed.messages[0]?.text).toBe("Home, 14 Kock Street");
  });

  it("shows the driver note on the receipt and asks for a pin or a typed address", () => {
    expect(fulfilmentSummary({ fulfilment: "DELIVERY", deliveryAddress: "14 Kock Street", deliveryNotes: "Blue gate" }, store)).toBe(
      "Delivery to 14 Kock Street\nDriver note: Blue gate",
    );
    const ask = deliveryAddressMessage({ ...store, deliveryFeeCents: 1500 } as Store);
    expect(ask.kind).toBe("text");
    if (ask.kind === "text") {
      expect(ask.text).toContain("R15.00");
      expect(ask.text).toContain("WhatsApp location pin");
      expect(ask.text).toContain("next line");
    }
    const note = deliveryNoteMessage();
    expect(note.kind).toBe("buttons");
    if (note.kind === "buttons") {
      expect(note.buttons[0]?.title).toBe("No note");
      expect(decodeReplyId(note.buttons[0]?.id)).toEqual({ kind: "deliveryNote", skip: true });
    }
  });
});
