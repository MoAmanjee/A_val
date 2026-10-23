import { parseJson, route } from "@/lib/api";
import { deleteLabourRate, updateLabourRate } from "@/services/labour";
import { labourBody } from "@/lib/schemas";

export const PUT = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(req, labourBody.partial());
  return { labourRate: await updateLabourRate(session.actor, params.id, body) };
});

export const DELETE = route<{ id: string }>(async ({ session, params }) => {
  await deleteLabourRate(session.actor, params.id);
  return { ok: true };
});
