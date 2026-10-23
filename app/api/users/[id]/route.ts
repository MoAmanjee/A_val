import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { updateUser } from "@/services/users";

export const PUT = route<{ id: string }>(
  async ({ req, session, params }) => {
    const body = await parseJson(
      req,
      z.object({ name: z.string().min(1).max(120).optional(), role: z.enum(["BUSINESS_ADMIN", "STAFF"]).optional(), active: z.boolean().optional(), password: z.string().min(10).max(200).optional() }),
    );
    return { user: await updateUser(session.actor, params.id, body) };
  },
  { roles: ["BUSINESS_ADMIN"] },
);
