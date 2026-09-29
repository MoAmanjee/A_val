import type { Role } from "@prisma/client";

/**
 * Every service call is made on behalf of an Actor. The businessId on the actor
 * is the ONLY source of tenancy: services never accept a businessId from request
 * bodies or from the AI.
 */
export type UserActor = {
  kind: "user";
  userId: string;
  businessId: string;
  role: Role;
  name?: string;
};

export type AiActor = {
  kind: "ai";
  businessId: string;
  conversationId: string;
};

export type SystemActor = {
  kind: "system";
  businessId: string;
  label?: string;
};

export type Actor = UserActor | AiActor | SystemActor;

export function actorLabel(actor: Actor): string {
  switch (actor.kind) {
    case "user":
      return "USER";
    case "ai":
      return "AI";
    default:
      return "SYSTEM";
  }
}

export function actorUserId(actor: Actor): string | null {
  return actor.kind === "user" ? actor.userId : null;
}
