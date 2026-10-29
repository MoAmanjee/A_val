import { describe, expect, it } from "vitest";
import {
  activeWebsitePromoWhere,
  dayWindowJohannesburg,
  formatScheduleLabel,
  johannesburgDateKey,
  resolveWebsiteSchedule,
  weekWindowJohannesburg,
} from "@/services/promotions/schedule";

describe("promotion website schedule", () => {
  it("builds a Johannesburg calendar-day window", () => {
    const { startsAt, endsAt } = dayWindowJohannesburg("2026-10-26");
    expect(startsAt.toISOString()).toBe("2026-10-25T22:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-10-26T22:00:00.000Z");
    expect(johannesburgDateKey(startsAt)).toBe("2026-10-26");
  });

  it("builds a Monday–Sunday week from any day in that week", () => {
    const wed = weekWindowJohannesburg("2026-10-28");
    expect(wed.startsAt.toISOString()).toBe("2026-10-25T22:00:00.000Z"); // Mon 00:00 SAST
    expect(wed.endsAt.toISOString()).toBe("2026-11-01T22:00:00.000Z"); // next Mon
    const sun = weekWindowJohannesburg("2026-11-01");
    expect(sun.startsAt.toISOString()).toBe(wed.startsAt.toISOString());
  });

  it("resolves daily, weekly, and custom schedules", () => {
    expect(resolveWebsiteSchedule({ kind: "DAILY", date: "2026-10-26" }).scheduleKind).toBe("DAILY");
    expect(resolveWebsiteSchedule({ kind: "WEEKLY", weekOf: "2026-10-26" }).scheduleKind).toBe("WEEKLY");
    const custom = resolveWebsiteSchedule({
      kind: "CUSTOM",
      startsAt: "2026-10-26T10:00",
      endsAt: "2026-10-26T21:00",
    });
    expect(custom.scheduleKind).toBe("CUSTOM");
    expect(custom.startsAt.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(custom.endsAt.toISOString()).toBe("2026-10-26T19:00:00.000Z");
  });

  it("rejects an inverted custom range", () => {
    expect(() =>
      resolveWebsiteSchedule({
        kind: "CUSTOM",
        startsAt: "2026-10-26T21:00",
        endsAt: "2026-10-26T10:00",
      }),
    ).toThrow(/end time/i);
  });

  it("describes active website promos by start/end window", () => {
    const now = new Date("2026-10-26T12:00:00.000Z");
    expect(activeWebsitePromoWhere(now)).toEqual({
      showOnWebsite: true,
      startsAt: { lte: now },
      endsAt: { gt: now },
    });
  });

  it("formats a schedule label", () => {
    const { startsAt, endsAt } = dayWindowJohannesburg("2026-10-26");
    expect(formatScheduleLabel("DAILY", startsAt, endsAt)).toMatch(/One day/i);
  });
});
