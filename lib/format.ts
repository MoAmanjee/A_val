export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function money(v: unknown, symbol = "R"): string {
  const n = num(v);
  const s = Math.abs(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u00a0/g, " ");
  return `${n < 0 ? "-" : ""}${symbol}${s}`;
}

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return "-";
  return new Date(v).toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function dateOnly(v: string | Date | null | undefined): string {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

export function timeAgo(v: string | Date | null | undefined): string {
  if (!v) return "";
  const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return dateOnly(v);
}

export function vehicleLabel(v: { year?: number | null; make?: string | null; model?: string | null; variant?: string | null; engine?: string | null } | null | undefined): string {
  if (!v) return "No vehicle";
  const parts = [v.year, v.make, v.model, v.variant].filter(Boolean);
  const base = parts.join(" ");
  return base || "Unidentified vehicle";
}

export function phoneLabel(phone: string | null | undefined): string {
  return phone ? `+${phone.replace(/^\+/, "")}` : "";
}

export const QUOTE_STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Draft", tone: "slate" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "amber" },
  APPROVED: { label: "Approved", tone: "blue" },
  SENT: { label: "Sent", tone: "indigo" },
  ACCEPTED: { label: "Accepted", tone: "green" },
  REJECTED: { label: "Declined", tone: "red" },
  EXPIRED: { label: "Expired", tone: "slate" },
  CANCELLED: { label: "Cancelled", tone: "red" },
};

export const CONVERSATION_STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "AI active", tone: "green" },
  WAITING_FOR_CUSTOMER: { label: "Waiting for customer", tone: "slate" },
  QUOTE_PENDING: { label: "Quote in progress", tone: "blue" },
  QUOTE_APPROVAL: { label: "Quote needs approval", tone: "amber" },
  HUMAN_REQUIRED: { label: "Human required", tone: "red" },
  COMPLETED: { label: "Completed", tone: "slate" },
  CLOSED: { label: "Closed", tone: "slate" },
};
