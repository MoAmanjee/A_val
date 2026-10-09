import type { MenuItem, Store } from "@prisma/client";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MOCHACHOS_MENU } from "@/db/menu";
import { resolveStorePhoneId } from "@/db/seed";
import { categoryItemsMessage, categoryListRows, fulfilmentSummary, mealUpgradeMessage } from "@/services/messaging/templates";
import { catalogFromMenu, parseUtterance, type ParsedLine } from "@/services/orders/dictate";
import { decodeReplyId, encodeReplyId } from "@/services/messaging/reply-ids";
import { lineTotalCents, orderTotals } from "@/services/orders/pricing";
import { isReadyToConfirm, nextRequirement, type Requirement } from "@/services/orders/requirements";
import type { FullOrder, FullOrderItem, ItemModifierLink } from "@/services/orders/query";
import { toGraphMessage } from "@/services/whatsapp/cloud";
import { verifyWebhookSignature } from "@/services/whatsapp";
import { WA_LIMITS } from "@/services/whatsapp/limits";
import { matchFaq } from "@/services/conversations/faq";
import { isGreeting, readAnythingElse, readConfirmation, wantsMenu, wantsMenuPictures } from "@/services/conversations/understanding";
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
    expect(matchFaq("do you deliver?", faqs)?.answer).toMatch(/Potchefstroom/);
    expect(matchFaq("do you deliver?", faqs)?.answer).not.toMatch(/collection only/i);
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
    const parsed = parseUtterance("do you deliver?", catalog);
    expect(parsed.ignoredAsQuestion).toBe(true);
    expect(parsed.lines).toHaveLength(0);
    expect(parsed.fulfilment).toBeNull();
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
      { kind: "menuPhotos" as const },
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

  it("puts menu pictures on the category list without exceeding 10 rows", () => {
    const categories = MOCHACHOS_MENU.categories.map((c, i) => ({ id: `c${i}`, name: c.name, description: c.description ?? null }));
    const rows = categoryListRows(categories);
    expect(rows[0].title).toBe("Menu pictures");
    expect(rows.length).toBeLessThanOrEqual(WA_LIMITS.maxListRows);
    expect(rows.some((r) => r.title.startsWith("Burger"))).toBe(true);
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
    expect(isReadyToConfirm(order)).toBe(true);
  });

  it("does not ask for a meal drink when the customer said no", () => {
    const order = {
      items: [line({ links: [link("ALWAYS", "flavour", ["Hot"]), link("MEAL_ONLY", "drink", ["Coke"])], chosen: ["flavour"], isMeal: false })],
    } as FullOrder;
    expect(nextRequirement(order)).toBeNull();
  });

  it("tells the customer what the meal includes", () => {
    const item = line({ links: [] });
    const message = mealUpgradeMessage({ items: [item] } as FullOrder, item, store);
    expect(message.kind).toBe("buttons");
    if (message.kind === "buttons") expect(message.body).toContain("beeg chips and a buddy drink");
  });
});
