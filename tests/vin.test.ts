import { describe, expect, it } from "vitest";
import { BasicVehicleDecoder, getVehicleDecoder, setVehicleDecoder, type VehicleDecoderService } from "@/services/vehicles/decoder";
import { extractVinFromText, normalizeVin, validateVin } from "@/utils/vin";

describe("VIN handling", () => {
  it("accepts a structurally valid VIN and normalises it", () => {
    expect(validateVin(" wvw zzz-auzgw123456 ").valid).toBe(true);
    expect(normalizeVin("wvw zzz-auzgw123456")).toBe("WVWZZZAUZGW123456");
  });
  it("rejects wrong length and forbidden letters", () => {
    expect(validateVin("ABC123").valid).toBe(false);
    expect(validateVin("WVWZZZAUZGW12345O").reason).toMatch(/I, O or Q/);
    expect(validateVin("WVWZZZAUZGW12345").reason).toMatch(/17/);
  });
  it("finds a VIN inside free text", () => {
    expect(extractVinFromText("my vin is wvwzzzauzgw123456 thanks")).toBe("WVWZZZAUZGW123456");
    expect(extractVinFromText("no vin here")).toBeNull();
  });
  it("basic decoder validates but never invents vehicle data", async () => {
    const r = await new BasicVehicleDecoder().decode("WVWZZZAUZGW123456");
    expect(r).toMatchObject({ valid: true, decoded: false, attributes: {} });
    expect((await new BasicVehicleDecoder().decode("bad")).valid).toBe(false);
  });
  it("supports plugging in an external decoder", async () => {
    const ext: VehicleDecoderService = {
      name: "ext",
      async decode(vin) {
        return { valid: true, vin, decoded: true, provider: "ext", attributes: { make: "Volkswagen", model: "Golf", year: 2016 } };
      },
    };
    setVehicleDecoder(ext);
    expect((await getVehicleDecoder().decode("WVWZZZAUZGW123456")).attributes.make).toBe("Volkswagen");
    setVehicleDecoder(null);
  });
});
