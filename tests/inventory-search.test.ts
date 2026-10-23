import { beforeAll, describe, expect, it } from "vitest";
import { applyOptionDisplayMode, searchParts } from "@/services/inventory/search";
import { resetAndSeed } from "./helpers";
import type { SeedResult } from "@/db/seed";

let s: SeedResult;
const golf = { make: "Volkswagen", model: "Golf 7", year: 2016, engine: "1.4 TSI", fuelType: "Petrol", transmission: "Manual" };

beforeAll(async () => {
  s = await resetAndSeed();
});

describe("inventory search", () => {
  it("finds every compatible front brake pad option for a Golf 7 1.4 TSI", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "front brake pads", vehicle: golf });
    const names = r.matches.map((m) => `${m.part.manufacturer}:${m.part.sku}`);
    expect(names).toEqual(expect.arrayContaining(["Bosch:BSH-BP-G7F", "Brembo:BRM-BP-G7F", "Generic:GEN-BP-G7F"]));
    // Fitment database is the source of truth: pads for other vehicles and rear pads never appear.
    expect(r.matches.some((m) => m.part.sku === "BSH-BP-HLX")).toBe(false);
    expect(r.matches.some((m) => m.part.sku === "BSH-BP-G7R")).toBe(false);
    expect(r.matches.length).toBe(3);
    expect(r.multipleOptions).toBe(true);
    expect(r.excludedByFitment).toBeGreaterThan(0);
    for (const m of r.matches) expect(["EXACT", "HIGH"]).toContain(m.fit.confidence);
  });

  it("returns price, stock, part number and manufacturer for each option", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "front brake pads", vehicle: golf });
    const bosch = r.matches.find((m) => m.part.sku === "BSH-BP-G7F")!;
    expect(bosch.part).toMatchObject({ partNumber: "BSH-0986-G7F", manufacturer: "Bosch", sellingPrice: 850, quantityInStock: 12 });
    expect(bosch.availability).toBe("IN_STOCK");
  });

  it("does not use the wrong vehicle's parts", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "brake pads", vehicle: { make: "Toyota", model: "Hilux", year: 2018, engine: "2.8 GD-6" } });
    expect(r.matches.map((m) => m.part.sku)).toEqual(["BSH-BP-HLX"]);
    expect(r.multipleOptions).toBe(false);
  });

  it("excludes parts that conflict on transmission (manual-only clutch vs DSG car)", async () => {
    const manual = await searchParts({ businessId: s.businessA.id, query: "clutch kit", vehicle: golf });
    expect(manual.matches.map((m) => m.part.sku)).toEqual(["VLO-CLT-G7"]);
    const dsg = await searchParts({ businessId: s.businessA.id, query: "clutch kit", vehicle: { ...golf, transmission: "DSG" } });
    expect(dsg.matches).toHaveLength(0);
    expect(dsg.excludedByFitment).toBe(1);
  });

  it("matches by exact part number and SKU regardless of vehicle", async () => {
    const byPn = await searchParts({ businessId: s.businessA.id, partNumber: "bsh-0986-g7f" });
    expect(byPn.matches[0].part.sku).toBe("BSH-BP-G7F");
    expect(byPn.matches[0].matchedBy).toBe("PART_NUMBER");
    const bySku = await searchParts({ businessId: s.businessA.id, query: "MNH-OF-VAG" });
    expect(bySku.matches[0]).toMatchObject({ matchedBy: "SKU" });
  });

  it("matches part numbers written with different punctuation", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "BSH 0986 G7F" });
    expect(r.matches[0]?.part.sku).toBe("BSH-BP-G7F");
  });

  it("flags out-of-stock parts instead of hiding them", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "front brake pads", vehicle: { make: "Ford", model: "Ranger", year: 2019 } });
    expect(r.matches[0].part.sku).toBe("BSH-BP-RGR");
    expect(r.matches[0].availability).toBe("OUT_OF_STOCK");
    expect(r.matches[0].notes).toContain("Out of stock");
  });

  it("returns universal parts with UNIVERSAL fitment", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "engine oil 5w-30", vehicle: golf });
    expect(r.matches[0].part.sku).toBe("CST-5W30-5L");
    expect(r.matches[0].fit.status).toBe("UNIVERSAL");
  });

  it("returns nothing for a part the business does not stock", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "turbocharger", vehicle: golf });
    expect(r.matches).toHaveLength(0);
  });

  it("uses front/rear as position signals", async () => {
    const rear = await searchParts({ businessId: s.businessA.id, query: "rear brake pads", vehicle: golf });
    expect(rear.matches.map((m) => m.part.sku)).toEqual(["BSH-BP-G7R"]);
  });

  it("supports synonyms (rotor -> disc) and plurals", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "front brake rotors", vehicle: golf });
    expect(r.matches[0].part.sku).toBe("BRM-BD-G7F");
  });

  it("asks for missing vehicle details when candidates differ by them", async () => {
    // Two spark-plug fitments exist for different engines; with no engine known the engine must be asked.
    const r = await searchParts({ businessId: s.businessA.id, query: "brake pads", vehicle: { make: "Volkswagen", model: "Golf 7", year: 2016 } });
    // Bosch/Brembo/Generic pads exist for both the 1.4 TSI and 1.2 TSI Golf 7, so the engine must be asked.
    expect(r.missingVehicleInfo).toContain("engine");
    const fronts = r.matches.filter((m) => m.part.sku.endsWith("G7F"));
    expect(fronts.every((m) => m.fit.unverified.includes("engine"))).toBe(true);
  });

  it("only searches inside the requesting business", async () => {
    const other = await searchParts({ businessId: s.businessB.id, query: "brake pads", vehicle: golf });
    expect(other.matches.map((m) => m.part.sku)).toEqual(["CAP-BP-001"]);
  });

  it("does not return inactive parts", async () => {
    const part = await (await import("./helpers")).prisma.part.findFirstOrThrow({ where: { businessId: s.businessA.id, sku: "GEN-BP-G7F" } });
    await (await import("./helpers")).prisma.part.update({ where: { id: part.id }, data: { active: false } });
    const r = await searchParts({ businessId: s.businessA.id, query: "front brake pads", vehicle: golf });
    expect(r.matches.some((m) => m.part.sku === "GEN-BP-G7F")).toBe(false);
    await (await import("./helpers")).prisma.part.update({ where: { id: part.id }, data: { active: true } });
  });
});

describe("option display modes", () => {
  it("ALL shows every option", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "front brake pads", vehicle: golf });
    expect(applyOptionDisplayMode(r.matches, "ALL").visible).toHaveLength(3);
  });

  it("CHEAPEST shows only the cheapest in-stock option and never labels anything best", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "front brake pads", vehicle: golf });
    const v = applyOptionDisplayMode(r.matches, "CHEAPEST");
    expect(v.visible.map((m) => m.part.sku)).toEqual(["GEN-BP-G7F"]);
    expect(v.hidden).toBe(2);
    expect(v.visible.every((m) => m.label === undefined)).toBe(true);
  });

  it("RECOMMENDED shows flagged parts, and falls back to all options when none is flagged (without labels)", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "front brake pads", vehicle: golf });
    expect(applyOptionDisplayMode(r.matches, "RECOMMENDED").visible).toHaveLength(3);
    const flagged = r.matches.map((m) => (m.part.sku === "BRM-BP-G7F" ? { ...m, part: { ...m.part, recommended: true }, label: "Recommended" as const } : m));
    const v = applyOptionDisplayMode(flagged, "RECOMMENDED");
    expect(v.visible.map((m) => m.part.sku)).toEqual(["BRM-BP-G7F"]);
    expect(v.visible[0].label).toBe("Recommended");
  });

  it("BUSINESS_SELECTED hides the choice from the customer", async () => {
    const r = await searchParts({ businessId: s.businessA.id, query: "front brake pads", vehicle: golf });
    const v = applyOptionDisplayMode(r.matches, "BUSINESS_SELECTED");
    expect(v.visible).toHaveLength(1);
    expect(v.businessWillConfirm).toBe(true);
  });
});
