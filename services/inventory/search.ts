import type { OptionDisplayMode, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  evaluatePartFit,
  normalizeText,
  vehicleHasIdentity,
  type Dimension,
  type PartFitResult,
  type VehicleSpec,
} from "@/services/vehicles/matching";
import { toNumber } from "@/utils/money";

export type Availability = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
export type MatchedBy = "SKU" | "PART_NUMBER" | "BARCODE" | "NAME" | "PARTIAL_NAME";

export interface PartSummary {
  id: string;
  sku: string;
  partNumber: string | null;
  barcode: string | null;
  name: string;
  description: string | null;
  category: string | null;
  manufacturer: string | null;
  sellingPrice: number;
  vatRate: number | null;
  quantityInStock: number;
  minimumStockLevel: number;
  universal: boolean;
  recommended: boolean;
  active: boolean;
}

export interface PartMatch {
  part: PartSummary;
  fit: PartFitResult;
  relevance: number;
  rank: number;
  matchedBy: MatchedBy;
  availability: Availability;
  /** Only ever "Recommended", and only when the business flagged the part. */
  label?: "Recommended";
  notes: string[];
}

export interface PartSearchInput {
  businessId: string;
  query?: string;
  partNumber?: string;
  sku?: string;
  category?: string;
  vehicle?: (VehicleSpec & { id?: string }) | null;
  limit?: number;
  includeInactive?: boolean;
}

export interface PartSearchResult {
  matches: PartMatch[];
  /** More than one compatible option exists for the same kind of part. */
  multipleOptions: boolean;
  /** Vehicle attributes that differ between candidate fitments and are unknown: ask the customer. */
  missingVehicleInfo: Dimension[];
  /** Vehicle attributes that candidates constrain and that should be double-checked. */
  confirmVehicleInfo: Dimension[];
  excludedByFitment: number;
  vehicleKnown: boolean;
  /** Human-readable ambiguities for the business reviewer. */
  ambiguities: string[];
}

const STOPWORDS = new Set([
  "a", "an", "the", "for", "my", "i", "need", "want", "new", "of", "to", "please", "some", "replace",
  "replacement", "replacing", "car", "vehicle", "part", "parts", "with", "and", "on", "in", "me", "our", "your",
  "looking", "get", "buy", "do", "you", "have", "any", "that", "is", "it", "sets", "pair",
]);

const SOFT_TOKENS = new Set(["front", "rear", "left", "right", "lh", "rh", "fr", "rr", "lhs", "rhs", "set"]);
const OPPOSITES: Record<string, string> = { front: "rear", rear: "front", left: "right", right: "left" };

const SYNONYM_GROUPS: string[][] = [
  ["disc", "rotor"],
  ["shock", "damper", "absorber", "strut"],
  ["pad", "lining"],
  ["plug", "sparkplug"],
  ["filter", "element"],
  ["battery", "accumulator"],
  ["wiper", "windscreen wiper"],
  ["bulb", "lamp", "globe"],
  ["belt", "drive belt", "fan belt"],
  ["coolant", "antifreeze"],
];

function stem(t: string): string {
  if (t.length > 3 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 3 && t.endsWith("es") && /(ch|sh|x|s)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function queryTokens(query: string): string[] {
  return normalizeText(query)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t))
    .map(stem);
}

function alternatives(token: string): string[] {
  const set = new Set([token]);
  for (const group of SYNONYM_GROUPS) {
    if (group.includes(token)) group.forEach((g) => set.add(g));
  }
  return [...set];
}

function compact(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function wordPrefixMatch(haystack: string, needle: string): boolean {
  if (!needle) return false;
  // Word-boundary prefix: "pad" matches "pads", not "spade".
  return ` ${haystack}`.includes(` ${needle}`);
}

function availabilityOf(qty: number, min: number): Availability {
  if (qty <= 0) return "OUT_OF_STOCK";
  if (qty <= min) return "LOW_STOCK";
  return "IN_STOCK";
}

export function summarisePart(p: Prisma.PartGetPayload<object>): PartSummary {
  return {
    id: p.id,
    sku: p.sku,
    partNumber: p.partNumber,
    barcode: p.barcode,
    name: p.name,
    description: p.description,
    category: p.category,
    manufacturer: p.manufacturer,
    sellingPrice: toNumber(p.sellingPrice),
    vatRate: p.vatRate === null ? null : toNumber(p.vatRate),
    quantityInStock: p.quantityInStock,
    minimumStockLevel: p.minimumStockLevel,
    universal: p.universal,
    recommended: p.recommended,
    active: p.active,
  };
}

type PartWithFitments = Prisma.PartGetPayload<{ include: { fitments: true } }>;

export async function searchParts(input: PartSearchInput): Promise<PartSearchResult> {
  const { businessId } = input;
  const limit = Math.min(input.limit ?? 25, 100);
  const vehicle = input.vehicle ?? null;
  const vehicleKnown = vehicleHasIdentity(vehicle);

  const rawQuery = [input.query, input.partNumber, input.sku].filter(Boolean).join(" ").trim();
  const explicitIds = [input.partNumber, input.sku].filter((x): x is string => !!x).map(compact).filter(Boolean);
  const queryCompact = compact(input.query);
  const identifierCandidates = new Set<string>(explicitIds);
  if (input.query && !/\s/.test(input.query.trim()) && queryCompact.length >= 3) identifierCandidates.add(queryCompact);
  const wholeCompact = compact(input.query);
  if (wholeCompact.length >= 4 && wholeCompact.length <= 30 && /\d/.test(wholeCompact)) identifierCandidates.add(wholeCompact);
  // A multi-word query might still contain an embedded part number, e.g. "brake pads 5Q0698151B".
  for (const w of (input.query ?? "").split(/\s+/)) {
    const c = compact(w);
    if (c.length >= 5 && /\d/.test(c) && /[A-Z]/.test(c)) identifierCandidates.add(c);
  }

  const qTokens = queryTokens(input.query ?? "");
  const required = qTokens.filter((t) => !SOFT_TOKENS.has(t));
  const soft = qTokens.filter((t) => SOFT_TOKENS.has(t));
  const categoryFilter = normalizeText(input.category);

  // ---- SQL prefilter (cheap, broad) ---------------------------------------
  const ors: Prisma.PartWhereInput[] = [];
  const textFields = ["name", "description", "category", "manufacturer"] as const;
  for (const t of required.length ? required : qTokens) {
    for (const alt of alternatives(t)) {
      for (const f of textFields) ors.push({ [f]: { contains: alt, mode: "insensitive" } });
    }
  }
  for (const id of identifierCandidates) {
    for (const f of ["sku", "partNumber", "barcode"] as const) ors.push({ [f]: { contains: id, mode: "insensitive" } });
  }
  // Identifiers are compared ignoring punctuation/spacing ("BSH 0986-G7F" == "BSH-0986-G7F"), which a plain
  // SQL LIKE cannot do, so resolve exact compact matches in SQL and add them to the candidate set.
  if (identifierCandidates.size > 0) {
    const ids = [...identifierCandidates];
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "parts"
      WHERE "businessId" = ${businessId}
        AND (
          upper(regexp_replace("sku", '[^A-Za-z0-9]', '', 'g')) = ANY(${ids})
          OR upper(regexp_replace(coalesce("partNumber", ''), '[^A-Za-z0-9]', '', 'g')) = ANY(${ids})
          OR upper(regexp_replace(coalesce("barcode", ''), '[^A-Za-z0-9]', '', 'g')) = ANY(${ids})
        )
      LIMIT 50`;
    if (rows.length) ors.push({ id: { in: rows.map((r) => r.id) } });
  }
  if (input.category && ors.length === 0) {
    ors.push({ category: { contains: input.category, mode: "insensitive" } });
  }
  if (ors.length === 0 && !rawQuery) {
    return {
      matches: [], multipleOptions: false, missingVehicleInfo: [], confirmVehicleInfo: [],
      excludedByFitment: 0, vehicleKnown, ambiguities: [],
    };
  }

  const candidates: PartWithFitments[] = await db.part.findMany({
    where: {
      businessId,
      ...(input.includeInactive ? {} : { active: true }),
      OR: ors.length ? ors : undefined,
    },
    include: { fitments: true },
    take: 600,
  });

  // ---- Deterministic ranking ----------------------------------------------
  const scored: PartMatch[] = [];
  const excludedIds = new Set<string>();

  const scoreCandidates = (strict: boolean) => {
    for (const p of candidates) {
      if (scored.some((s) => s.part.id === p.id)) continue;
      const skuC = compact(p.sku);
      const pnC = compact(p.partNumber);
      const bcC = compact(p.barcode);
      let matchedBy: MatchedBy | null = null;
      let relevance = 0;

      for (const id of identifierCandidates) {
        if (id && skuC === id) { matchedBy = "SKU"; relevance = 100; break; }
        if (id && pnC === id) { matchedBy = "PART_NUMBER"; relevance = 98; break; }
        if (id && bcC === id) { matchedBy = "BARCODE"; relevance = 96; break; }
      }

      const nameN = normalizeText(p.name);
      const hay = normalizeText(
        [p.name, p.category, p.description, p.manufacturer, ...p.fitments.map((f) => f.notes)].filter(Boolean).join(" "),
      );

      if (!matchedBy) {
        if (qTokens.length === 0 && !categoryFilter) continue;
        if (required.length === 0 && soft.length > 0 && !categoryFilter) {
          // Only position words: too vague to search on.
          continue;
        }
        const matchedRequired = required.filter((t) => alternatives(t).some((a) => wordPrefixMatch(hay, a)));
        const coverage = required.length ? matchedRequired.length / required.length : 1;
        if (strict ? coverage < 1 : coverage < 0.5) continue;

        // Reject explicit position conflicts (query says "front", part says "rear" only).
        let positionConflict = false;
        for (const s of soft) {
          const opp = OPPOSITES[s];
          if (opp && wordPrefixMatch(hay, opp) && !wordPrefixMatch(hay, s)) positionConflict = true;
        }
        if (positionConflict) continue;

        if (categoryFilter) {
          const cat = normalizeText(p.category);
          if (!cat.includes(categoryFilter) && !hay.includes(categoryFilter)) continue;
        }

        const nameCovered = required.filter((t) => alternatives(t).some((a) => wordPrefixMatch(nameN, a))).length;
        const nameCoverage = required.length ? nameCovered / required.length : 0;
        const softHits = soft.filter((s) => wordPrefixMatch(hay, s)).length;
        const phrase = required.length > 1 && nameN.includes(required.join(" ")) ? 12 : 0;
        const extraWords = Math.max(0, nameN.split(" ").length - qTokens.length);
        relevance = Math.max(
          0,
          Math.round(coverage * 20 + nameCoverage * 40 + phrase + softHits * 4 + (categoryFilter ? 5 : 0) - extraWords * 2),
        );
        matchedBy = coverage < 1 ? "PARTIAL_NAME" : "NAME";
      }

      const fit = evaluatePartFit(
        vehicle,
        p,
        p.fitments.map((f) => ({
          id: f.id, make: f.make, model: f.model, yearFrom: f.yearFrom, yearTo: f.yearTo, variant: f.variant,
          engine: f.engine, engineCode: f.engineCode, fuelType: f.fuelType, transmission: f.transmission, notes: f.notes,
        })),
      );
      if (fit.status === "CONFLICT") {
        excludedIds.add(p.id);
        continue;
      }

      const notes: string[] = [];
      if (matchedBy === "PARTIAL_NAME") notes.push("Only part of the description matched this part");
      if (fit.status === "NO_DATA") notes.push("No fitment data on file - compatibility not verified");
      if (fit.status === "NO_VEHICLE") notes.push("Vehicle not identified yet - compatibility not verified");
      if (fit.status === "FITMENT" && fit.unverified.length > 0) {
        notes.push(`Unverified vehicle details: ${fit.unverified.join(", ")}`);
      }
      if (fit.notes) notes.push(fit.notes);
      const availability = availabilityOf(p.quantityInStock, p.minimumStockLevel);
      if (availability === "OUT_OF_STOCK") notes.push("Out of stock");

      const summary = summarisePart(p);
      const idHit = relevance >= 90;
      scored.push({
        part: summary,
        fit,
        relevance,
        rank: (idHit ? 1000 : 0) + fit.score + relevance,
        matchedBy,
        availability,
        label: p.recommended ? "Recommended" : undefined,
        notes,
      });
    }
  };

  scoreCandidates(true);
  if (scored.length === 0 && required.length > 1) scoreCandidates(false);

  scored.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    const aIn = a.availability === "OUT_OF_STOCK" ? 0 : 1;
    const bIn = b.availability === "OUT_OF_STOCK" ? 0 : 1;
    if (aIn !== bIn) return bIn - aIn;
    return a.part.sellingPrice - b.part.sellingPrice;
  });
  const matches = scored.slice(0, limit);

  // ---- Ambiguity analysis -------------------------------------------------
  const ambiguities: string[] = [];
  const groups = new Map<string, PartMatch[]>();
  for (const m of matches) {
    if (m.fit.status === "NO_DATA" || m.matchedBy === "PARTIAL_NAME") continue;
    const key = normalizeText(m.part.category) || normalizeText(m.part.name);
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }
  let multipleOptions = false;
  for (const [key, arr] of groups) {
    const usable = arr.filter((m) => m.availability !== "OUT_OF_STOCK");
    if (usable.length > 1) {
      multipleOptions = true;
      ambiguities.push(`${usable.length} compatible options found for "${key || "part"}"`);
    }
  }

  const missing: Dimension[] = [];
  const confirm: Dimension[] = [];
  const dimsToCheck: Dimension[] = ["model", "year", "variant", "engine", "engineCode", "fuelType", "transmission"];
  for (const dim of dimsToCheck) {
    const withDim = matches.filter((m) => m.fit.status === "FITMENT" && m.fit.unverified.includes(dim));
    if (withDim.length === 0) continue;
    const values = new Set<string>();
    for (const m of withDim) {
      for (const row of m.fit.compatibleRows ?? []) {
        if (!row.unverified.includes(dim)) continue;
        const f = row.fitment;
        const v = dim === "year" ? (f.yearFrom != null || f.yearTo != null ? `${f.yearFrom ?? ""}-${f.yearTo ?? ""}` : "") : normalizeText((f as unknown as Record<string, string | null | undefined>)[dim]);
        if (v) values.add(v);
      }
    }
    if (values.size >= 2) missing.push(dim);
    else confirm.push(dim);
  }
  if (missing.length) ambiguities.push(`Candidate parts differ by: ${missing.join(", ")} (vehicle value unknown)`);

  return {
    matches,
    multipleOptions,
    missingVehicleInfo: missing,
    confirmVehicleInfo: confirm,
    excludedByFitment: excludedIds.size,
    vehicleKnown,
    ambiguities,
  };
}

/**
 * Apply the business's configured OptionDisplayMode to decide which matches the
 * AI may present to the customer. Nothing is ever labelled "best" unless the
 * business flagged it as recommended.
 */
export function applyOptionDisplayMode(
  matches: PartMatch[],
  mode: OptionDisplayMode,
): { visible: PartMatch[]; hidden: number; businessWillConfirm: boolean } {
  if (mode === "ALL") return { visible: matches, hidden: 0, businessWillConfirm: false };

  const groups = new Map<string, PartMatch[]>();
  for (const m of matches) {
    const key = normalizeText(m.part.category) || normalizeText(m.part.name);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const cheapest = (arr: PartMatch[]) => {
    const inStock = arr.filter((m) => m.availability !== "OUT_OF_STOCK");
    const pool = inStock.length ? inStock : arr;
    return [...pool].sort((a, b) => a.part.sellingPrice - b.part.sellingPrice)[0];
  };

  const visible: PartMatch[] = [];
  for (const arr of groups.values()) {
    if (mode === "CHEAPEST" || mode === "BUSINESS_SELECTED") {
      visible.push(cheapest(arr));
    } else if (mode === "RECOMMENDED") {
      const rec = arr.filter((m) => m.part.recommended);
      visible.push(...(rec.length ? rec : arr));
    }
  }
  const order = new Map(matches.map((m, i) => [m.part.id, i]));
  visible.sort((a, b) => (order.get(a.part.id) ?? 0) - (order.get(b.part.id) ?? 0));
  return {
    visible,
    hidden: matches.length - visible.length,
    businessWillConfirm: mode === "BUSINESS_SELECTED",
  };
}
