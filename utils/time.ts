/**
 * The store runs on Africa/Johannesburg time while the server may be anywhere,
 * so every customer-facing time and every trading-hours check goes through here
 * rather than using the host clock's local timezone.
 */
export const DEFAULT_TIMEZONE = "Africa/Johannesburg";

export interface ZonedParts {
  /** 0 = Sunday ... 6 = Saturday, in the store's timezone. */
  dayOfWeek: number;
  hour: number;
  minute: number;
  /** Minutes since local midnight, for comparing against opening hours. */
  minutesOfDay: number;
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
