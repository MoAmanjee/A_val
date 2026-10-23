import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getStorage } from "@/services/storage";

/** Tenant-isolated file access: a user can only read keys under their own business prefix. */
export const GET = route<{ key: string[] }>(async ({ session, params }) => {
  const key = params.key.join("/");
  if (!key.startsWith(`${session.businessId}/`) || key.includes("..")) throw new ForbiddenError();
  const file = await getStorage().get(key);
  if (!file) throw new NotFoundError("File");
  return new NextResponse(new Uint8Array(file.data), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=300" },
  });
});
