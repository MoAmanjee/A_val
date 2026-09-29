import { env } from "@/lib/env";
import { validateVin } from "@/utils/vin";

export interface DecodedVehicle {
  make?: string;
  model?: string;
  year?: number;
  variant?: string;
  engine?: string;
  engineSize?: string;
  engineCode?: string;
  fuelType?: string;
  transmission?: string;
}

export interface VinDecodeResult {
  valid: boolean;
  vin: string;
  /** false when no provider was able to decode attributes (still may be valid). */
  decoded: boolean;
  provider: string;
  attributes: DecodedVehicle;
  error?: string;
}

/**
 * Abstraction over VIN decoding providers. Plug in any external decoding API by
 * implementing this interface and registering it with `setVehicleDecoder`.
 */
export interface VehicleDecoderService {
  readonly name: string;
  decode(vin: string): Promise<VinDecodeResult>;
}

/** Validates VIN structure only. Does not invent vehicle data. */
export class BasicVehicleDecoder implements VehicleDecoderService {
  readonly name = "basic";
  async decode(input: string): Promise<VinDecodeResult> {
    const v = validateVin(input);
    return {
      valid: v.valid,
      vin: v.vin,
      decoded: false,
      provider: this.name,
      attributes: {},
      error: v.valid ? undefined : v.reason,
    };
  }
}

/**
 * NHTSA vPIC decoder (free, no key). Coverage is best for North American market
 * vehicles; European/other VINs often return partial data.
 */
export class NhtsaVehicleDecoder implements VehicleDecoderService {
  readonly name = "nhtsa";
  async decode(input: string): Promise<VinDecodeResult> {
    const v = validateVin(input);
    if (!v.valid) {
      return { valid: false, vin: v.vin, decoded: false, provider: this.name, attributes: {}, error: v.reason };
    }
    try {
      const res = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(v.vin)}?format=json`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) throw new Error(`NHTSA responded ${res.status}`);
      const body = (await res.json()) as { Results?: Record<string, string>[] };
      const r = body.Results?.[0] ?? {};
      const clean = (s?: string) => (s && s.trim() && s !== "Not Applicable" ? s.trim() : undefined);
      const year = Number(r.ModelYear);
      const attributes: DecodedVehicle = {
        make: clean(r.Make),
        model: clean(r.Model),
        year: Number.isFinite(year) && year > 1950 ? year : undefined,
        variant: clean(r.Trim),
        engineSize: clean(r.DisplacementL) ? Number(r.DisplacementL).toFixed(1) : undefined,
        engineCode: clean(r.EngineModel),
        fuelType: clean(r.FuelTypePrimary),
        transmission: clean(r.TransmissionStyle),
      };
      const decoded = !!(attributes.make && attributes.model);
      return { valid: true, vin: v.vin, decoded, provider: this.name, attributes };
    } catch (e) {
      return {
        valid: true,
        vin: v.vin,
        decoded: false,
        provider: this.name,
        attributes: {},
        error: `VIN decoding service unavailable: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

let override: VehicleDecoderService | null = null;

export function setVehicleDecoder(decoder: VehicleDecoderService | null) {
  override = decoder;
}

export function getVehicleDecoder(): VehicleDecoderService {
  if (override) return override;
  return env.vinDecoder === "nhtsa" ? new NhtsaVehicleDecoder() : new BasicVehicleDecoder();
}
