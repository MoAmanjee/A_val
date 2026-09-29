import { parseJson, route } from "@/lib/api";
import { getVehicle, updateVehicle } from "@/services/vehicles";
import { vehicleBody } from "@/lib/schemas";

export const GET = route<{ id: string }>(async ({ session, params }) => ({ vehicle: await getVehicle(session.businessId, params.id) }));

export const PUT = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(req, vehicleBody.partial());
  return { vehicle: await updateVehicle(session.actor, params.id, body) };
});
