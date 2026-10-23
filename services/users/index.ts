import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/services/audit";
import { hashPassword } from "@/services/auth";
import type { UserActor } from "@/types/actor";

const publicSelect = { id: true, name: true, email: true, role: true, active: true, createdAt: true } as const;

export async function listUsers(businessId: string) {
  return db.user.findMany({ where: { businessId }, select: publicSelect, orderBy: { createdAt: "asc" } });
}

function assertAssignableRole(actor: UserActor, role: Role) {
  if (role === "SUPER_ADMIN") throw new ForbiddenError("Cannot assign the platform administrator role");
  if (actor.role === "STAFF") throw new ForbiddenError();
}

export async function createUser(actor: UserActor, input: { name: string; email: string; password: string; role: Role }) {
  assertAssignableRole(actor, input.role);
  if (input.password.length < 10) throw new ValidationError("Password must be at least 10 characters");
  const email = input.email.trim().toLowerCase();
  if (await db.user.findUnique({ where: { email } })) throw new ConflictError("A user with this email already exists");
  const user = await db.user.create({
    data: { businessId: actor.businessId, name: input.name.trim(), email, role: input.role, passwordHash: await hashPassword(input.password) },
    select: publicSelect,
  });
  await audit(actor, { action: "user.create", entityType: "User", entityId: user.id, summary: `User ${email} created as ${input.role}` });
  return user;
}

export async function updateUser(
  actor: UserActor,
  id: string,
  patch: { name?: string; role?: Role; active?: boolean; password?: string },
) {
  const existing = await db.user.findFirst({ where: { id, businessId: actor.businessId } });
  if (!existing) throw new NotFoundError("User");
  if (patch.role) assertAssignableRole(actor, patch.role);
  if (id === actor.userId && (patch.active === false || (patch.role && patch.role !== existing.role))) {
    throw new ValidationError("You cannot deactivate or change the role of your own account");
  }
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.password) {
    if (patch.password.length < 10) throw new ValidationError("Password must be at least 10 characters");
    data.passwordHash = await hashPassword(patch.password);
  }
  const user = await db.user.update({ where: { id }, data, select: publicSelect });
  await audit(actor, {
    action: "user.update",
    entityType: "User",
    entityId: id,
    summary: `User ${existing.email} updated (${Object.keys(data).map((k) => (k === "passwordHash" ? "password" : k)).join(", ")})`,
  });
  return user;
}
