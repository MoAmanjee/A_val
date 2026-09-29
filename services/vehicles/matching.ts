/**
 * Deterministic vehicle <-> fitment matching. No LLM involved: the fitment
 * database is the source of truth for compatibility.
 *
 * A fitment row leaves a field null to mean "applies to any". A vehicle leaves a
 * field null when the value is not (yet) known. Each dimension therefore ends up
 * as one of:
 *   match       - both known and compatible
 *   any         - fitment row does not constrain this dimension
 *   unverified  - fitment constrains it but the vehicle value is unknown
 *   conflict    - both known and incompatible (row is rejected)
 */

export interface VehicleSpec {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  variant?: string | null;
  engine?: string | null;
  engineSize?: string | null;
  engineCode?: string | null;
  fuelType?: string | null;
  transmission?: string | null;
  vinDecoded?: boolean | null;
}

export interface FitmentSpec {
  id?: string;
  make: string;
  model?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  variant?: string | null;
  engine?: string | null;
  engineCode?: string | null;
  fuelType?: string | null;
  transmission?: string | null;
  notes?: string | null;
}

export type Dimension = "make" | "model" | "year" | "variant" | "engine" | "engineCode" | "fuelType" | "transmission";
export type DimStatus = "match" | "any" | "unverified" | "conflict";
export type FitmentConfidence = "EXACT" | "HIGH" | "MEDIUM" | "LOW";

export interface FitmentEvaluation {
  compatible: boolean;
  score: number;
  confidence: FitmentConfidence;
  dimensions: Record<Dimension, DimStatus>;
  unverified: Dimension[];
  conflicts: Dimension[];
  fitment: FitmentSpec;
}

const MAKE_ALIASES: Record<string, string> = {
  vw: "volkswagen",
  merc: "mercedes benz",
  mercedes: "mercedes benz",
  "mercedes benz": "mercedes benz",
  benz: "mercedes benz",
  chevy: "chevrolet",
  landrover: "land rover",
  "range rover": "land rover",
  bmw: "bmw",
  mini: "mini",
};

const FUEL_ALIASES: Record<string, string> = {
  gasoline: "petrol",
  gas: "petrol",
  unleaded: "petrol",
  petrol: "petrol",
  tsi: "petrol",
  tfsi: "petrol",
  diesel: "diesel",
  tdi: "diesel",
  hybrid: "hybrid",
  phev: "hybrid",
  electric: "electric",
  ev: "electric",
  lpg: "lpg",
};

const TRANSMISSION_ALIASES: Record<string, string> = {
  manual: "manual",
  mt: "manual",
  stick: "manual",
  automatic: "automatic",
  auto: "automatic",
  at: "automatic",
  tiptronic: "automatic",
  dsg: "automatic",
  dct: "automatic",
  cvt: "automatic",
  amt: "automatic",
};

export function normalizeText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d)\.(\d)\s*l\b/g, "$1.$2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string | null | undefined): string[] {
  const n = normalizeText(s);
  return n ? n.split(" ") : [];
}

export function normalizeMake(s: string | null | undefined): string {
  const n = normalizeText(s);
  return MAKE_ALIASES[n] ?? n;
}

function normalizeAlias(s: string | null | undefined, aliases: Record<string, string>): string {
  const n = normalizeText(s);
  if (!n) return "";
  for (const t of n.split(" ")) if (aliases[t]) return aliases[t];
  return n;
}

function subset(a: string[], b: string[]): boolean {
  return a.every((t) => b.includes(t));
}

/** Free-text comparison with subset semantics (see module header). */
function compareText(fit: string | null | undefined, veh: string | null | undefined): DimStatus {
  const f = tokens(fit);
  if (f.length === 0) return "any";
  const v = tokens(veh);
  if (v.length === 0) return "unverified";
  if (subset(f, v)) return "match";
  if (subset(v, f)) return "unverified";
  return "conflict";
}

function compareAlias(
  fit: string | null | undefined,
  veh: string | null | undefined,
  aliases: Record<string, string>,
): DimStatus {
  const f = normalizeAlias(fit, aliases);
  if (!f) return "any";
  const v = normalizeAlias(veh, aliases);
  if (!v) return "unverified";
  return f === v ? "match" : "conflict";
}

function compareYear(fit: FitmentSpec, year: number | null | undefined): DimStatus {
  if (fit.yearFrom == null && fit.yearTo == null) return "any";
  if (year == null) return "unverified";
  if (fit.yearFrom != null && year < fit.yearFrom) return "conflict";
  if (fit.yearTo != null && year > fit.yearTo) return "conflict";
  return "match";
}

function compareModel(fit: string | null | undefined, veh: string | null | undefined): DimStatus {
  const f = tokens(fit);
  if (f.length === 0) return "any";
  const v = tokens(veh);
  if (v.length === 0) return "unverified";
  // "Golf" vs "Golf 7" vs "Golf 7 GTI": either direction of containment is a model match;
  // year range and variant disambiguate generations.
  if (subset(f, v) || subset(v, f)) return "match";
  return "conflict";
}

const WEIGHTS: Record<Dimension, number> = {
  make: 15,
  model: 25,
  year: 20,
  engine: 15,
  variant: 10,
  engineCode: 5,
  fuelType: 5,
  transmission: 5,
};

function dimScore(dim: Dimension, status: DimStatus): number {
  const w = WEIGHTS[dim];
  if (status === "match") return w;
  if (status === "any") return Math.round(w * 0.6);
  return 0;
}

export function confidenceFromScore(score: number): FitmentConfidence {
  if (score >= 90) return "EXACT";
  if (score >= 75) return "HIGH";
  if (score >= 55) return "MEDIUM";
  return "LOW";
}

export function evaluateFitment(vehicle: VehicleSpec, fitment: FitmentSpec): FitmentEvaluation {
  const vehEngineText = [vehicle.engine, vehicle.engineSize].filter(Boolean).join(" ");
  const vehVariantText = [vehicle.variant, vehicle.model].filter(Boolean).join(" ");

  const makeF = normalizeMake(fitment.make);
  const makeV = normalizeMake(vehicle.make);
  const make: DimStatus = !makeF ? "any" : !makeV ? "unverified" : makeF === makeV ? "match" : "conflict";

  const dimensions: Record<Dimension, DimStatus> = {
    make,
    model: compareModel(fitment.model, vehicle.model),
    year: compareYear(fitment, vehicle.year),
    variant: compareText(fitment.variant, vehVariantText),
    engine: compareText(fitment.engine, vehEngineText),
    engineCode: fitment.engineCode
      ? vehicle.engineCode
        ? normalizeText(fitment.engineCode) === normalizeText(vehicle.engineCode)
          ? "match"
          : "conflict"
        : "unverified"
      : "any",
    fuelType: compareAlias(fitment.fuelType, vehicle.fuelType, FUEL_ALIASES),
    transmission: compareAlias(fitment.transmission, vehicle.transmission, TRANSMISSION_ALIASES),
  };

  // The engine name often implies a fuel type (e.g. "TDI"); use it to avoid asking redundant questions.
  if (dimensions.fuelType === "unverified" && vehicle.engine) {
    const implied = tokens(vehicle.engine)
      .map((t) => FUEL_ALIASES[t])
      .find(Boolean);
    if (implied) {
      dimensions.fuelType = implied === normalizeAlias(fitment.fuelType, FUEL_ALIASES) ? "match" : "conflict";
    }
  }

  const dims = Object.keys(dimensions) as Dimension[];
  const conflicts = dims.filter((d) => dimensions[d] === "conflict");
  const unverified = dims.filter((d) => dimensions[d] === "unverified");
  let score = dims.reduce((sum, d) => sum + dimScore(d, dimensions[d]), 0);

  // VIN-derived vehicles are more trustworthy: decoded data replaces guesses.
  if (vehicle.vinDecoded && conflicts.length === 0) score = Math.min(100, score + 5);

  return {
    compatible: conflicts.length === 0,
    score,
    confidence: confidenceFromScore(score),
    dimensions,
    unverified,
    conflicts,
    fitment,
  };
}

export type PartFitStatus = "FITMENT" | "UNIVERSAL" | "NO_DATA" | "NO_VEHICLE" | "CONFLICT";

export interface PartFitResult {
  status: PartFitStatus;
  confidence: FitmentConfidence | "UNIVERSAL" | "UNVERIFIED" | "NONE";
  score: number;
  best?: FitmentEvaluation;
  /** Every compatible fitment row, best first. */
  compatibleRows?: FitmentEvaluation[];
  unverified: Dimension[];
  notes?: string;
  /** Present when status is CONFLICT: every row was rejected. */
  rejections?: FitmentEvaluation[];
}

/** True if the vehicle is specific enough for fitment checks to mean anything. */
export function vehicleHasIdentity(vehicle: VehicleSpec | null | undefined): boolean {
  return !!vehicle && !!normalizeMake(vehicle.make);
}

export function evaluatePartFit(
  vehicle: VehicleSpec | null | undefined,
  part: { universal?: boolean | null },
  fitments: FitmentSpec[],
): PartFitResult {
  if (!vehicleHasIdentity(vehicle)) {
    return { status: "NO_VEHICLE", confidence: "NONE", score: 0, unverified: [] };
  }
  if (fitments.length === 0) {
    if (part.universal) return { status: "UNIVERSAL", confidence: "UNIVERSAL", score: 60, unverified: [] };
    return {
      status: "NO_DATA",
      confidence: "UNVERIFIED",
      score: 0,
      unverified: [],
      notes: "No fitment data on file for this part",
    };
  }
  const evals = fitments.map((f) => evaluateFitment(vehicle!, f));
  const compatible = evals.filter((e) => e.compatible);
  if (compatible.length === 0) {
    return { status: "CONFLICT", confidence: "NONE", score: 0, unverified: [], rejections: evals };
  }
  compatible.sort((a, b) => b.score - a.score);
  const best = compatible[0];
  return {
    status: "FITMENT",
    confidence: best.confidence,
    score: best.score,
    best,
    compatibleRows: compatible,
    unverified: best.unverified,
    notes: best.fitment.notes ?? undefined,
  };
}
