import { parseJson, route } from "@/lib/api";
import { deleteFitment, updateFitment } from "@/services/inventory";
import { fitmentBody } from "@/lib/schemas";

export const PUT = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(req, fitmentBody.partial());
  return { fitment: await updateFitment(session.actor, params.id, body) };
});

export const DELETE = route<{ id: string }>(async ({ session, params }) => {
  await deleteFitment(session.actor, params.id);
  return { ok: true };
});
