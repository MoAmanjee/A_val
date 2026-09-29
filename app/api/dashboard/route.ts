import { route } from "@/lib/api";
import { getSidebarCounts } from "@/services/dashboard";

export const GET = route(async ({ session }) => getSidebarCounts(session.businessId));
