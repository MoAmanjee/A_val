import type { PromotionScheduleKind } from "@prisma/client";
import { DEFAULT_TIMEZONE } from "@/utils/time";

/** South Africa Standard Time is fixed UTC+2 (no DST). */
const SAST_OFFSET = "+02:00";

export type WebsiteScheduleInput =
  | { kind: "DAILY"; date: string }
  | { kind: "WEEKLY"; weekOf: string }
  | { kind: "CUSTOM"; startsAt: string; endsAt: string };

export interface ScheduleWindow {
  scheduleKind: PromotionScheduleKind;
  startsAt: Date;
  endsAt: Date;
}

/** YYYY-MM-DD in Africa/Johannesburg for a given instant. */
export function johannesburgDateKey(at = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function assertDateKey(value: string, label: string): string {
  const key = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new Error(`Pick a ${label} date (YYYY-MM-DD).`);
  }
  const probe = new Date(`${key}T12:00:00${SAST_OFFSET}`);
  if (Number.isNaN(probe.getTime())) throw new Error(`That ${label} date is not valid.`);
  return key;
}

/** Local midnight SAST → exclusive next midnight for one calendar day. */
export function dayWindowJohannesburg(dateKey: string): { startsAt: Date; endsAt: Date } {
  const key = assertDateKey(dateKey, "day");
  const startsAt = new Date(`${key}T00:00:00.000${SAST_OFFSET}`);
  const next = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
  return { startsAt, endsAt: next };
}

/** Monday 00:00 SAST through next Monday 00:00 for the week containing weekOf. */
export function weekWindowJohannesburg(weekOf: string): { startsAt: Date; endsAt: Date } {
  const key = assertDateKey(weekOf, "week");
  const noon = new Date(`${key}T12:00:00.000${SAST_OFFSET}`);
  // getUTCDay adjusted for SAST: noon SAST is 10:00 UTC, so UTC day === SAST day.
  const day = noon.getUTCDay(); // 0 Sun … 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const mondayKey = johannesburgDateKey(new Date(noon.getTime() + mondayOffset * 24 * 60 * 60 * 1000));
  const startsAt = new Date(`${mondayKey}T00:00:00.000${SAST_OFFSET}`);
  const endsAt = new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { startsAt, endsAt };
}

function parseDateTimeLocal(raw: string, label: string): Date {
  const value = raw.trim();
  if (!value) throw new Error(`Set the ${label} time.`);
  // Accept "YYYY-MM-DDTHH:mm" or full ISO. Bare local forms are treated as SAST.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value}:00${SAST_OFFSET}`);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value}${SAST_OFFSET}`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000${SAST_OFFSET}`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`That ${label} time is not valid.`);
  return parsed;
}

export function resolveWebsiteSchedule(input: WebsiteScheduleInput): ScheduleWindow {
  if (input.kind === "DAILY") {
    const { startsAt, endsAt } = dayWindowJohannesburg(input.date);
    return { scheduleKind: "DAILY", startsAt, endsAt };
  }
  if (input.kind === "WEEKLY") {
    const { startsAt, endsAt } = weekWindowJohannesburg(input.weekOf);
    return { scheduleKind: "WEEKLY", startsAt, endsAt };
  }
  const startsAt = parseDateTimeLocal(input.startsAt, "start");
  const endsAt = parseDateTimeLocal(input.endsAt, "end");
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error("The end time must be after the start time.");
  }
  return { scheduleKind: "CUSTOM", startsAt, endsAt };
}

/** Prisma where-clause fragment: website promo still inside its active window. */
export function activeWebsitePromoWhere(now = new Date()) {
  return {
    showOnWebsite: true as const,
    startsAt: { lte: now },
    endsAt: { gt: now },
  };
}

export function formatScheduleLabel(
  kind: PromotionScheduleKind | null | undefined,
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
): string {
  if (!kind || !startsAt || !endsAt) return "";
  const fmtDay = new Intl.DateTimeFormat("en-ZA", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const fmtStamp = new Intl.DateTimeFormat("en-ZA", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (kind === "DAILY") return `Today only · ${fmtDay.format(startsAt)}`;
  if (kind === "WEEKLY") {
    const lastDay = new Date(endsAt.getTime() - 1);
    return `This week · ${fmtDay.format(startsAt)} – ${fmtDay.format(lastDay)}`;
  }
  return `${fmtStamp.format(startsAt)} – ${fmtStamp.format(endsAt)}`;
}
