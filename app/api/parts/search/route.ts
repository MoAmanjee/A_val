import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { db } from "@/lib/db";
import type { VehicleSpec } from "@/services/vehicles/matching";
import { applyOptionDisplayMode, searchParts } from "@/services/inventory/search";

/** Staff-facing search with optional vehicle context (all options, plus what customers would see). */
export const GET = route(async ({ req, session }) => {
  const q = parseQuery(
    req,
    z.object({
      q: z.string().optional(),
      category: z.string().optional(),
      partNumber: z.string().optional(),
      vehicleId: z.string().optional(),
      make: z.string().optional(),
      model: z.string().optional(),
      year: z.coerce.number().int().optional(),
      variant: z.string().optional(),
      engine: z.string().optional(),
    }),
  );
  let vehicle: VehicleSpec | null = q.make || q.model ? { make: q.make, model: q.model, year: q.year, variant: q.variant, engine: q.engine } : null;
  if (q.vehicleId) vehicle = await db.vehicle.findFirst({ where: { id: q.vehicleId, businessId: session.businessId } });
  const business = await db.business.findUniqueOrThrow({ where: { id: session.businessId } });
  const result = await searchParts({ businessId: session.businessId, query: q.q, category: q.category, partNumber: q.partNumber, vehicle });
  return { ...result, customerVisible: applyOptionDisplayMode(result.matches, business.optionDisplayMode) };
});
