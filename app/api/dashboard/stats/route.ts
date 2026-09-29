import { route } from "@/lib/api";
import { getDashboardStats } from "@/services/dashboard";

export const GET = route(async ({ session }) => getDashboardStats(session.businessId));
