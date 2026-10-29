/**
 * The store runs on Africa/Johannesburg time while the server may be anywhere,
 * so every customer-facing time and every trading-hours check goes through here
 * rather than using the host clock's local timezone.
 */
export const DEFAULT_TIMEZONE = "Africa/Johannesburg";

/** South Africa Standard Time is fixed UTC+2 (no DST). */
const SAST_OFFSET = "+02:00";

export interface ZonedParts {
  /** 0 = Sunday ... 6 = Saturday, in the store's timezone. */
  dayOfWeek: number;
  hour: number;
  minute: number;
  /** Minutes since local midnight, for comparing against opening hours. */
  minutesOfDay: number;
}

export interface DateWindow {
  startsAt: Date;
  endsAt: Date;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(at: Date, timeZone = DEFAULT_TIMEZONE): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dayOfWeek = Math.max(0, WEEKDAYS.indexOf(get("weekday")));
  // Intl renders midnight as "24" in some ICU versions.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { dayOfWeek, hour, minute, minutesOfDay: hour * 60 + minute };
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
export function dayWindowJohannesburg(dateKey: string): DateWindow {
  const key = assertDateKey(dateKey, "day");
  const startsAt = new Date(`${key}T00:00:00.000${SAST_OFFSET}`);
  const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
  return { startsAt, endsAt };
}

/**
 * Kitchen History weeks run Monday 00:00 → next Monday 00:00 (Africa/Johannesburg).
 * Pass any date in the week (YYYY-MM-DD); defaults to “today” in Johannesburg.
 */
export function weekWindowJohannesburg(weekOf?: string | Date): DateWindow {
  const key =
    typeof weekOf === "string"
      ? assertDateKey(weekOf, "week")
      : johannesburgDateKey(weekOf instanceof Date ? weekOf : new Date());
  const noon = new Date(`${key}T12:00:00.000${SAST_OFFSET}`);
  // Noon SAST is 10:00 UTC, so UTC weekday matches the Johannesburg weekday.
  const day = noon.getUTCDay(); // 0 Sun … 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const mondayKey = johannesburgDateKey(new Date(noon.getTime() + mondayOffset * 24 * 60 * 60 * 1000));
  const startsAt = new Date(`${mondayKey}T00:00:00.000${SAST_OFFSET}`);
  const endsAt = new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { startsAt, endsAt };
}

/** Seven YYYY-MM-DD keys from Monday through Sunday for the week containing `at`. */
export function weekDayKeysJohannesburg(at = new Date()): string[] {
  const { startsAt } = weekWindowJohannesburg(at);
  return Array.from({ length: 7 }, (_, i) =>
    johannesburgDateKey(new Date(startsAt.getTime() + i * 24 * 60 * 60 * 1000)),
  );
}

/** "18:45" in the store's timezone. */
export function formatClock(at: Date, timeZone = DEFAULT_TIMEZONE): string {
  const { hour, minute } = zonedParts(at, timeZone);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

/** Parses "18:30" into minutes since midnight. Returns null when malformed. */
export function parseClock(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 24 || minute > 59) return null;
  return hour * 60 + minute;
}

export interface TradingWindow {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  closed: boolean;
}

export interface OpenState {
  open: boolean;
  /** Human text for the reply, e.g. "we open at 10:00" or "we close at 21:00". */
  opensAt?: string;
  closesAt?: string;
}

/**
 * A window whose closing time is not after its opening time runs past midnight
 * (e.g. 18:00-01:00), so the late hours belong to the previous day's window.
 */
export function isOpenAt(windows: TradingWindow[], at: Date, timeZone = DEFAULT_TIMEZONE): OpenState {
  const { dayOfWeek, minutesOfDay } = zonedParts(at, timeZone);
  const today = windows.find((w) => w.dayOfWeek === dayOfWeek);
  const yesterday = windows.find((w) => w.dayOfWeek === (dayOfWeek + 6) % 7);

  if (yesterday && !yesterday.closed) {
    const opens = parseClock(yesterday.opensAt);
    const closes = parseClock(yesterday.closesAt);
    if (opens !== null && closes !== null && closes <= opens && minutesOfDay < closes) {
      return { open: true, closesAt: yesterday.closesAt };
    }
  }
  if (!today || today.closed) {
    const next = nextOpening(windows, dayOfWeek);
    return { open: false, opensAt: next ?? undefined };
  }
  const opens = parseClock(today.opensAt);
  const closes = parseClock(today.closesAt);
  if (opens === null || closes === null) return { open: false };
  const closesNormalised = closes <= opens ? closes + 24 * 60 : closes;
  if (minutesOfDay < opens) return { open: false, opensAt: today.opensAt };
  if (minutesOfDay >= closesNormalised) {
    const next = nextOpening(windows, dayOfWeek);
    return { open: false, opensAt: next ?? undefined };
  }
  return { open: true, closesAt: today.closesAt };
}

function nextOpening(windows: TradingWindow[], fromDay: number): string | null {
  for (let i = 1; i <= 7; i++) {
    const w = windows.find((x) => x.dayOfWeek === (fromDay + i) % 7);
    if (w && !w.closed) return w.opensAt;
  }
  return null;
}
