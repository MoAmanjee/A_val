import { describe, expect, it } from "vitest";
import { evaluateFitment, evaluatePartFit, normalizeMake, type FitmentSpec, type VehicleSpec } from "@/services/vehicles/matching";

const golf: VehicleSpec = { make: "VW", model: "Golf", year: 2016, engine: "1.4 TSI", fuelType: "Petrol", transmission: "Manual" };

const golf7Tsi: FitmentSpec = { make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020, engine: "1.4 TSI", fuelType: "Petrol" };

describe("vehicle <-> fitment matching", () => {
  it("normalises make aliases", () => {
    expect(normalizeMake("VW")).toBe("volkswagen");
    expect(normalizeMake("Volkswagen")).toBe("volkswagen");
    expect(normalizeMake("Merc")).toBe("mercedes benz");
  });

  it("matches an exact vehicle with high confidence", () => {
    const e = evaluateFitment(golf, golf7Tsi);
    expect(e.compatible).toBe(true);
    expect(["EXACT", "HIGH"]).toContain(e.confidence);
    expect(e.dimensions.make).toBe("match");
    expect(e.dimensions.year).toBe("match");
    expect(e.dimensions.engine).toBe("match");
  });

  it("treats 'Golf' and 'Golf 7' as the same model and lets the year range disambiguate", () => {
    expect(evaluateFitment({ ...golf, year: 2016 }, golf7Tsi).compatible).toBe(true);
    expect(evaluateFitment({ ...golf, year: 2009 }, golf7Tsi).compatible).toBe(false);
  });

  it("rejects a different make/model", () => {
    expect(evaluateFitment({ ...golf, model: "Polo" }, golf7Tsi).conflicts).toContain("model");
    expect(evaluateFitment({ ...golf, make: "Toyota" }, golf7Tsi).conflicts).toContain("make");
  });

  it("rejects engine, fuel and transmission conflicts", () => {
    expect(evaluateFitment({ ...golf, engine: "2.0 TDI" }, golf7Tsi).conflicts).toContain("engine");
    expect(evaluateFitment({ ...golf, fuelType: "Diesel", engine: null }, golf7Tsi).conflicts).toContain("fuelType");
    const manualOnly: FitmentSpec = { ...golf7Tsi, transmission: "Manual" };
    expect(evaluateFitment({ ...golf, transmission: "DSG" }, manualOnly).conflicts).toContain("transmission");
  });

  it("infers fuel type from the engine name (TDI => diesel)", () => {
    const e = evaluateFitment({ make: "VW", model: "Golf", year: 2016, engine: "2.0 TDI" }, { make: "Volkswagen", model: "Golf 7", fuelType: "Petrol" });
    expect(e.conflicts).toContain("fuelType");
  });

  it("marks constrained-but-unknown attributes as unverified, not conflicting", () => {
    const e = evaluateFitment({ make: "Volkswagen", model: "Golf", year: 2016 }, golf7Tsi);
    expect(e.compatible).toBe(true);
    expect(e.unverified).toEqual(expect.arrayContaining(["engine", "fuelType"]));
  });

  it("scores a fully verified specific match above a generic one", () => {
    const specific = evaluateFitment(golf, golf7Tsi);
    const generic = evaluateFitment(golf, { make: "Volkswagen", model: "Golf" });
    expect(specific.score).toBeGreaterThan(generic.score);
  });

  it("supports engine text variants (1.4L TSI vs 1.4 TSI vs 1.4tsi)", () => {
    for (const engine of ["1.4L TSI", "1.4tsi", "1.4 tsi"]) {
      expect(evaluateFitment({ ...golf, engine }, golf7Tsi).dimensions.engine).toBe("match");
    }
  });

  it("matches on engine code when both are known", () => {
    const fit: FitmentSpec = { make: "Volkswagen", model: "Golf", engineCode: "CZCA" };
    expect(evaluateFitment({ ...golf, engineCode: "czca" }, fit).dimensions.engineCode).toBe("match");
    expect(evaluateFitment({ ...golf, engineCode: "CJZA" }, fit).conflicts).toContain("engineCode");
  });

  it("boosts confidence for VIN-decoded vehicles", () => {
    const base = evaluateFitment({ ...golf, engine: null, fuelType: null }, golf7Tsi);
    const decoded = evaluateFitment({ ...golf, engine: null, fuelType: null, vinDecoded: true }, golf7Tsi);
    expect(decoded.score).toBeGreaterThanOrEqual(base.score);
  });
});

describe("part-level fitment", () => {
  it("picks the best of several fitment rows", () => {
    const r = evaluatePartFit(golf, {}, [
      { make: "Volkswagen", model: "Polo" },
      { make: "Volkswagen", model: "Golf 7", yearFrom: 2013, yearTo: 2020, engine: "1.4 TSI" },
      { make: "Volkswagen", model: "Golf" },
    ]);
    expect(r.status).toBe("FITMENT");
    expect(r.best?.fitment.engine).toBe("1.4 TSI");
  });

  it("reports CONFLICT when every fitment row is incompatible", () => {
    const r = evaluatePartFit(golf, {}, [{ make: "Toyota", model: "Hilux" }]);
    expect(r.status).toBe("CONFLICT");
  });

  it("returns UNIVERSAL for parts flagged universal and NO_DATA otherwise", () => {
    expect(evaluatePartFit(golf, { universal: true }, []).status).toBe("UNIVERSAL");
    expect(evaluatePartFit(golf, { universal: false }, []).status).toBe("NO_DATA");
  });

  it("does not claim fitment when the vehicle is unknown", () => {
    expect(evaluatePartFit(null, {}, [golf7Tsi]).status).toBe("NO_VEHICLE");
    expect(evaluatePartFit({ model: "Golf" }, {}, [golf7Tsi]).status).toBe("NO_VEHICLE");
  });
});
