import { parseJson, route } from "@/lib/api";
import { deletePart, getPart, updatePart } from "@/services/inventory";
import { partBody } from "@/lib/schemas";

export const GET = route<{ id: string }>(async ({ session, params }) => ({ part: await getPart(session.businessId, params.id) }));

export const PUT = route<{ id: string }>(async ({ req, session, params }) => {
  const body = await parseJson(req, partBody.partial());
  return { part: await updatePart(session.actor, params.id, body) };
});

export const DELETE = route<{ id: string }>(async ({ session, params }) => deletePart(session.actor, params.id), {
  roles: ["BUSINESS_ADMIN"],
});
