import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { audit } from "@/services/audit";
import type { Actor } from "@/types/actor";
import { normalizeText } from "@/services/vehicles/matching";

export const MAX_IMPORT_ROWS = 50_000;

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

export type FieldDef = { key: string; label: string; required?: boolean; synonyms: string[] };

export const PART_IMPORT_FIELDS: FieldDef[] = [
  { key: "sku", label: "SKU", required: true, synonyms: ["sku", "stock code", "stockcode", "item code", "product code", "code", "stock no", "item no"] },
  { key: "partNumber", label: "Part Number", synonyms: ["part number", "part no", "part #", "partnumber", "oem", "oem number", "mpn", "manufacturer part number"] },
  { key: "name", label: "Description / Name", required: true, synonyms: ["description", "name", "part name", "item", "item description", "product", "product name", "title"] },
  { key: "description", label: "Long description", synonyms: ["long description", "details", "notes", "extended description"] },
  { key: "manufacturer", label: "Manufacturer / Brand", synonyms: ["manufacturer", "brand", "make", "supplier brand", "mfr"] },
  { key: "category", label: "Category", synonyms: ["category", "group", "product group", "type", "department"] },
  { key: "costPrice", label: "Cost Price", synonyms: ["cost price", "cost", "buy price", "purchase price", "cost excl", "trade price"] },
  { key: "sellingPrice", label: "Selling Price", synonyms: ["selling price", "retail price", "price", "sell price", "retail", "sale price", "list price", "unit price"] },
  { key: "quantityInStock", label: "Stock Quantity", synonyms: ["stock quantity", "quantity", "qty", "stock", "on hand", "qty on hand", "in stock", "stock on hand", "soh"] },
  { key: "minimumStockLevel", label: "Minimum Stock", synonyms: ["minimum stock", "min stock", "min qty", "reorder level", "reorder point", "minimum"] },
  { key: "barcode", label: "Barcode", synonyms: ["barcode", "ean", "upc", "gtin"] },
  { key: "location", label: "Location / Bin", synonyms: ["location", "bin", "shelf", "bin location"] },
  { key: "vatRate", label: "VAT rate %", synonyms: ["vat rate", "vat %", "tax rate", "vat"] },
];

export const FITMENT_IMPORT_FIELDS: FieldDef[] = [
  { key: "partNumber", label: "Part Number", synonyms: ["part number", "part no", "partnumber", "part #", "oem", "oem number"] },
  { key: "sku", label: "SKU (alternative lookup)", synonyms: ["sku", "stock code", "item code", "code"] },
  { key: "make", label: "Make", required: true, synonyms: ["make", "brand", "manufacturer", "vehicle make"] },
  { key: "model", label: "Model", synonyms: ["model", "vehicle model"] },
  { key: "yearFrom", label: "Year From", synonyms: ["year from", "from year", "year start", "start year", "from", "yearfrom"] },
  { key: "yearTo", label: "Year To", synonyms: ["year to", "to year", "year end", "end year", "to", "yearto"] },
  { key: "variant", label: "Variant", synonyms: ["variant", "trim", "submodel", "series"] },
  { key: "engine", label: "Engine", synonyms: ["engine", "engine size", "motor"] },
  { key: "engineCode", label: "Engine Code", synonyms: ["engine code", "enginecode", "motor code"] },
  { key: "fuelType", label: "Fuel Type", synonyms: ["fuel type", "fuel"] },
  { key: "transmission", label: "Transmission", synonyms: ["transmission", "gearbox"] },
  { key: "notes", label: "Notes", synonyms: ["notes", "comment", "comments", "remarks"] },
];

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("result" in o) return cellToString(o.result as ExcelJS.CellValue);
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return String(o.text);
    if ("error" in o) return "";
    return String(v);
  }
  return String(v).trim();
}

export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  let matrix: string[][];
  if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new ValidationError("The workbook has no worksheets");
    matrix = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as ExcelJS.CellValue[];
      matrix.push(values.slice(1).map(cellToString));
    });
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    let text = buffer.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    matrix = parsed.data.map((r) => r.map((c) => (c ?? "").toString().trim()));
  } else {
    throw new ValidationError("Unsupported file type. Upload a .csv or .xlsx file.");
  }
  if (matrix.length < 2) throw new ValidationError("The file must contain a header row and at least one data row");
  if (matrix.length - 1 > MAX_IMPORT_ROWS) throw new ValidationError(`Too many rows (max ${MAX_IMPORT_ROWS})`);

  const width = Math.max(...matrix.map((r) => r.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    let h = (matrix[0][i] ?? "").trim() || `Column ${i + 1}`;
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    if (n > 0) h = `${h} (${n + 1})`;
    return h;
  });
  const rows = matrix.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (r[i] ?? "").trim()));
    return obj;
  });
  return { headers, rows };
}

/** field key -> spreadsheet header (or null when not mapped). */
export type ColumnMapping = Record<string, string | null>;

export function suggestMapping(headers: string[], fields: FieldDef[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  const norm = headers.map((h) => ({ h, n: normalizeText(h) }));
  // Exact synonym matches first, in synonym priority order, then loose containment.
  for (const f of fields) {
    mapping[f.key] = null;
    for (const syn of f.synonyms) {
      const hit = norm.find((x) => !used.has(x.h) && x.n === syn);
      if (hit) {
        mapping[f.key] = hit.h;
        used.add(hit.h);
        break;
      }
    }
  }
  for (const f of fields) {
    if (mapping[f.key]) continue;
    for (const syn of f.synonyms) {
      const hit = norm.find((x) => !used.has(x.h) && syn.length > 3 && x.n.includes(syn));
      if (hit) {
        mapping[f.key] = hit.h;
        used.add(hit.h);
        break;
      }
    }
  }
  return mapping;
}

export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.replace(/[^\d.,\-]/g, "");
  if (!s || s === "-") return null;
  // Decide decimal separator: last separator followed by 1-2 digits at end = decimal.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot && /,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function get(row: Record<string, string>, mapping: ColumnMapping, key: string): string | undefined {
  const header = mapping[key];
  if (!header) return undefined;
  const v = row[header];
  return v === undefined || v === "" ? undefined : v;
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
}

function assertMapped(mapping: ColumnMapping, fields: FieldDef[], anyOf?: string[]) {
  const missing = fields.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
  if (missing.length) throw new ValidationError(`Map a column for: ${missing.join(", ")}`);
  if (anyOf && !anyOf.some((k) => mapping[k])) throw new ValidationError(`Map a column for at least one of: ${anyOf.join(", ")}`);
}

export async function importParts(
  actor: Actor,
  sheet: ParsedSheet,
  mapping: ColumnMapping,
  opts: { updateExisting?: boolean } = {},
): Promise<ImportSummary> {
  // SKU falls back to part number when only the latter is mapped.
  const effective = { ...mapping };
  if (!effective.sku && effective.partNumber) effective.sku = effective.partNumber;
  assertMapped(effective, PART_IMPORT_FIELDS);
  const updateExisting = opts.updateExisting ?? true;

  const existing = await db.part.findMany({ where: { businessId: actor.businessId }, select: { id: true, sku: true } });
  const bySku = new Map(existing.map((p) => [p.sku.toLowerCase(), p.id]));

  const summary: ImportSummary = { total: sheet.rows.length, created: 0, updated: 0, skipped: 0, errors: [] };
  const toCreate: Prisma.PartCreateManyInput[] = [];
  const toUpdate: { id: string; data: Prisma.PartUncheckedUpdateInput }[] = [];
  const seenInFile = new Set<string>();

  sheet.rows.forEach((row, idx) => {
    const rowNo = idx + 2;
    try {
      const sku = get(row, effective, "sku");
      const name = get(row, effective, "name");
      if (!sku) throw new Error("Missing SKU");
      if (!name) throw new Error("Missing description");
      const key = sku.toLowerCase();
      if (seenInFile.has(key)) throw new Error(`Duplicate SKU "${sku}" in file`);
      seenInFile.add(key);

      const numeric = (k: string, label: string, opts2: { int?: boolean; min?: number; max?: number } = {}) => {
        const raw = get(row, effective, k);
        if (raw === undefined) return undefined;
        const n = parseNumber(raw);
        if (n === null) throw new Error(`${label} "${raw}" is not a number`);
        if (n < (opts2.min ?? 0)) throw new Error(`${label} cannot be negative`);
        if (opts2.max !== undefined && n > opts2.max) throw new Error(`${label} is too large`);
        return opts2.int ? Math.round(n) : n;
      };
      const cost = numeric("costPrice", "Cost price");
      const sell = numeric("sellingPrice", "Selling price");
      const qty = numeric("quantityInStock", "Stock quantity", { int: true });
      const min = numeric("minimumStockLevel", "Minimum stock", { int: true });
      const vat = numeric("vatRate", "VAT rate", { max: 100 });

      const base = {
        name,
        partNumber: get(row, effective, "partNumber") ?? (mapping.sku ? undefined : sku),
        barcode: get(row, effective, "barcode"),
        description: get(row, effective, "description"),
        category: get(row, effective, "category"),
        manufacturer: get(row, effective, "manufacturer"),
        location: get(row, effective, "location"),
        ...(cost !== undefined ? { costPrice: cost.toFixed(2) } : {}),
        ...(sell !== undefined ? { sellingPrice: sell.toFixed(2) } : {}),
        ...(qty !== undefined ? { quantityInStock: qty } : {}),
        ...(min !== undefined ? { minimumStockLevel: min } : {}),
        ...(vat !== undefined ? { vatRate: vat.toFixed(2) } : {}),
      };

      const id = bySku.get(key);
      if (id) {
        if (!updateExisting) {
          summary.skipped++;
          return;
        }
        // Only overwrite fields that were mapped and non-empty in the file.
        const data: Prisma.PartUncheckedUpdateInput = {};
        for (const [k, v] of Object.entries(base)) if (v !== undefined) (data as Record<string, unknown>)[k] = v;
        toUpdate.push({ id, data });
      } else {
        toCreate.push({ ...base, businessId: actor.businessId, sku });
      }
    } catch (e) {
      summary.errors.push({ row: rowNo, message: e instanceof Error ? e.message : String(e) });
    }
  });

  for (let i = 0; i < toCreate.length; i += 500) {
    const res = await db.part.createMany({ data: toCreate.slice(i, i + 500), skipDuplicates: true });
    summary.created += res.count;
  }
  for (let i = 0; i < toUpdate.length; i += 100) {
    const batch = toUpdate.slice(i, i + 100);
    await db.$transaction(batch.map((u) => db.part.updateMany({ where: { id: u.id, businessId: actor.businessId }, data: u.data })));
    summary.updated += batch.length;
  }

  await audit(actor, {
    action: "inventory.import",
    entityType: "Part",
    summary: `Inventory import: ${summary.created} created, ${summary.updated} updated, ${summary.errors.length} errors`,
    details: { created: summary.created, updated: summary.updated, skipped: summary.skipped, errors: summary.errors.length },
  });
  return summary;
}

export async function importFitment(actor: Actor, sheet: ParsedSheet, mapping: ColumnMapping): Promise<ImportSummary> {
  assertMapped(mapping, FITMENT_IMPORT_FIELDS, ["partNumber", "sku"]);

  const parts = await db.part.findMany({
    where: { businessId: actor.businessId },
    select: { id: true, sku: true, partNumber: true },
  });
  const byPn = new Map<string, string[]>();
  const bySku = new Map<string, string>();
  for (const p of parts) {
    bySku.set(p.sku.toLowerCase(), p.id);
    if (p.partNumber) {
      const k = p.partNumber.toLowerCase();
      byPn.set(k, [...(byPn.get(k) ?? []), p.id]);
    }
  }

  const summary: ImportSummary = { total: sheet.rows.length, created: 0, updated: 0, skipped: 0, errors: [] };
  const toCreate: Prisma.VehicleFitmentCreateManyInput[] = [];

  sheet.rows.forEach((row, idx) => {
    const rowNo = idx + 2;
    try {
      const pn = get(row, mapping, "partNumber");
      const sku = get(row, mapping, "sku");
      const make = get(row, mapping, "make");
      if (!make) throw new Error("Missing make");
      let partIds: string[] = [];
      if (pn) partIds = byPn.get(pn.toLowerCase()) ?? [];
      if (partIds.length === 0 && sku) {
        const id = bySku.get(sku.toLowerCase());
        if (id) partIds = [id];
      }
      if (partIds.length === 0) throw new Error(`No part found for "${pn ?? sku ?? ""}"`);

      const yf = get(row, mapping, "yearFrom");
      const yt = get(row, mapping, "yearTo");
      const yearFrom = yf ? parseNumber(yf) : null;
      const yearTo = yt ? parseNumber(yt) : null;
      if (yf && (yearFrom === null || yearFrom < 1900 || yearFrom > 2100)) throw new Error(`Invalid year from "${yf}"`);
      if (yt && (yearTo === null || yearTo < 1900 || yearTo > 2100)) throw new Error(`Invalid year to "${yt}"`);
      if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error("Year from is after year to");

      for (const partId of partIds) {
        toCreate.push({
          partId,
          make,
          model: get(row, mapping, "model") ?? null,
          yearFrom: yearFrom === null ? null : Math.round(yearFrom),
          yearTo: yearTo === null ? null : Math.round(yearTo),
          variant: get(row, mapping, "variant") ?? null,
          engine: get(row, mapping, "engine") ?? null,
          engineCode: get(row, mapping, "engineCode") ?? null,
          fuelType: get(row, mapping, "fuelType") ?? null,
          transmission: get(row, mapping, "transmission") ?? null,
          notes: get(row, mapping, "notes") ?? null,
        });
      }
    } catch (e) {
      summary.errors.push({ row: rowNo, message: e instanceof Error ? e.message : String(e) });
    }
  });

  // Make re-imports idempotent: skip rows identical to an existing fitment.
  const involved = [...new Set(toCreate.map((c) => c.partId))];
  const existing = involved.length
    ? await db.vehicleFitment.findMany({ where: { partId: { in: involved } } })
    : [];
  const keyOf = (f: {
    partId: string; make: string; model?: string | null; yearFrom?: number | null; yearTo?: number | null;
    variant?: string | null; engine?: string | null; engineCode?: string | null; fuelType?: string | null; transmission?: string | null;
  }) =>
    [f.partId, f.make, f.model, f.yearFrom, f.yearTo, f.variant, f.engine, f.engineCode, f.fuelType, f.transmission]
      .map((x) => (x ?? "").toString().toLowerCase())
      .join("|");
  const existingKeys = new Set(existing.map(keyOf));
  const fresh = toCreate.filter((c) => {
    const k = keyOf(c);
    if (existingKeys.has(k)) {
      summary.skipped++;
      return false;
    }
    existingKeys.add(k);
    return true;
  });
  for (let i = 0; i < fresh.length; i += 500) {
    const res = await db.vehicleFitment.createMany({ data: fresh.slice(i, i + 500) });
    summary.created += res.count;
  }

  await audit(actor, {
    action: "fitment.import",
    entityType: "VehicleFitment",
    summary: `Fitment import: ${summary.created} created, ${summary.skipped} duplicates skipped, ${summary.errors.length} errors`,
    details: { created: summary.created, skipped: summary.skipped, errors: summary.errors.length },
  });
  return summary;
}
