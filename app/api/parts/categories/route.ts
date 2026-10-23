import { route } from "@/lib/api";
import { listCategories } from "@/services/inventory";

export const GET = route(async ({ session }) => ({ categories: await listCategories(session.businessId) }));
