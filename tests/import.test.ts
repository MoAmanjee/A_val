import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import type { SeedResult } from "@/db/seed";
import { importFitment, importParts, parseNumber, parseSpreadsheet, suggestMapping, PART_IMPORT_FIELDS, FITMENT_IMPORT_FIELDS } from "@/services/inventory/import";
import { searchParts } from "@/services/inventory/search";
import { prisma, resetAndSeed } from "./helpers";

let s: SeedResult;

beforeAll(async () => {
  s = await resetAndSeed();
});

const csv = (text: string) => parseSpreadsheet(Buffer.from(text), "stock.csv");

describe("spreadsheet parsing and column mapping", () => {
  it("suggests mappings from common supplier headers", async () => {
    const sheet = await csv("Stock Code,Item Description,Retail Price,Cost Excl,Qty On Hand,Brand,Bin\nX1,Thing,100,60,5,Bosch,A1\n");
    const m = suggestMapping(sheet.headers, PART_IMPORT_FIELDS);
    expect(m).toMatchObject({ sku: "Stock Code", name: "Item Description", sellingPrice: "Retail Price", costPrice: "Cost Excl", quantityInStock: "Qty On Hand", manufacturer: "Brand", location: "Bin" });
  });

  it("parses currency formatting", () => {
    expect(parseNumber("R 1 250,50")).toBe(1250.5);
    expect(parseNumber("R1,250.50")).toBe(1250.5);
    expect(parseNumber("1250")).toBe(1250);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });

  it("reads xlsx files", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Stock");
    ws.addRow(["Stock Code", "Description", "Price", "Qty"]);
    ws.addRow(["XL-1", "Wheel bearing", 450, 6]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const sheet = await parseSpreadsheet(buf, "stock.xlsx");
    expect(sheet.headers).toEqual(["Stock Code", "Description", "Price", "Qty"]);
    expect(sheet.rows[0]).toMatchObject({ "Stock Code": "XL-1", Description: "Wheel bearing", Price: "450", Qty: "6" });
  });
});

describe("inventory import", () => {
  it("creates and updates parts, reporting bad rows without aborting the file", async () => {
    const sheet = await csv(
      [
        "Stock Code,Item Description,Retail Price,Cost,Qty,Brand",
        "IMP-1,Wheel Bearing Front,\"R1,250.00\",800,6,SKF",
        "IMP-2,Timing Belt Kit,2100,1400,3,Gates",
        ",Missing SKU part,100,50,1,X",
        "IMP-3,Negative price,-5,1,1,X",
        "IMP-1,Duplicate in file,1,1,1,X",
        "BSH-BP-G7F,Front Brake Pad Set,899,520,20,Bosch",
      ].join("\n"),
    );
    const mapping = suggestMapping(sheet.headers, PART_IMPORT_FIELDS);
    const before = await prisma.part.findFirstOrThrow({ where: { businessId: s.businessA.id, sku: "BSH-BP-G7F" } });
    const summary = await importParts(s.actorA, sheet, mapping);
    expect(summary).toMatchObject({ total: 6, created: 2, updated: 1 });
    expect(summary.errors.map((e) => e.row).sort()).toEqual([4, 5, 6]);

    const bearing = await prisma.part.findFirstOrThrow({ where: { businessId: s.businessA.id, sku: "IMP-1" } });
    expect(Number(bearing.sellingPrice)).toBe(1250);
    expect(bearing.quantityInStock).toBe(6);
    expect(bearing.manufacturer).toBe("SKF");

    const updated = await prisma.part.findUniqueOrThrow({ where: { id: before.id } });
    expect(Number(updated.sellingPrice)).toBe(899);
    expect(updated.quantityInStock).toBe(20);
    expect(updated.name).toBe(before.name);
  });

  it("only touches the importing business", async () => {
    expect(await prisma.part.count({ where: { businessId: s.businessB.id, sku: { in: ["IMP-1", "IMP-2"] } } })).toBe(0);
    const bBefore = await prisma.part.findFirstOrThrow({ where: { businessId: s.businessB.id, sku: "CAP-BP-001" } });
    const sheet = await csv("SKU,Name,Price\nCAP-BP-001,Hijacked,1\n");
    await importParts(s.actorA, sheet, suggestMapping(sheet.headers, PART_IMPORT_FIELDS));
    const bAfter = await prisma.part.findUniqueOrThrow({ where: { id: bBefore.id } });
    expect(bAfter.name).toBe(bBefore.name);
    expect(bAfter.sellingPrice.toString()).toBe(bBefore.sellingPrice.toString());
  });

  it("requires mapped SKU and name columns", async () => {
    const sheet = await csv("A,B\n1,2\n");
    await expect(importParts(s.actorA, sheet, { sku: null, name: null })).rejects.toThrow(/Map a column/);
  });
});

describe("fitment import", () => {
  it("imports fitment rows by part number or SKU and makes the parts findable", async () => {
    const sheet = await csv(
      [
        "Part Number,Make,Model,Year From,Year To,Engine,Fuel",
        "IMP-1,VW,Polo,2010,2017,1.2 TSI,Petrol",
        "IMP-2,Volkswagen,Golf 7,2013,2020,1.4 TSI,",
        "NOPE-99,Volkswagen,Golf 7,2013,2020,,",
        "IMP-1,,Polo,2010,2017,,",
      ].join("\n"),
    );
    const summary = await importFitment(s.actorA, sheet, suggestMapping(sheet.headers, FITMENT_IMPORT_FIELDS));
    expect(summary.created).toBe(2);
    expect(summary.errors).toHaveLength(2);
    expect(summary.errors[0].message).toMatch(/NOPE-99|not found|part/i);

    const again = await importFitment(s.actorA, sheet, suggestMapping(sheet.headers, FITMENT_IMPORT_FIELDS));
    expect(again.created).toBe(0);
    expect(await prisma.vehicleFitment.count({ where: { part: { businessId: s.businessA.id, sku: "IMP-1" } } })).toBe(1);

    const golf = await prisma.vehicle.findFirstOrThrow({ where: { businessId: s.businessA.id, model: "Golf 7" } });
    const found = await searchParts({ businessId: s.businessA.id, query: "timing belt", vehicle: golf });
    expect(found.matches.map((m) => m.part.sku)).toContain("IMP-2");
    const polo = await searchParts({ businessId: s.businessA.id, query: "timing belt", vehicle: golf });
    expect(polo.matches.map((m) => m.part.sku)).not.toContain("IMP-1");
  });
});
