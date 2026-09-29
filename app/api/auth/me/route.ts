import { route } from "@/lib/api";

export const GET = route(async ({ session }) => ({ user: session.user }));
