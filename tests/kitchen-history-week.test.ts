import { describe, expect, it } from "vitest";
import {
  dayWindowJohannesburg,
  johannesburgDateKey,
  weekDayKeysJohannesburg,
  weekWindowJohannesburg,
} from "@/utils/time";

describe("kitchen history week windows (Africa/Johannesburg)", () => {
  it("starts the week on Monday 00:00 SAST", () => {
    // Wednesday 22 Oct 2025 15:00 SAST
    const midWeek = new Date("2025-10-22T13:00:00.000Z");
    const { startsAt, endsAt } = weekWindowJohannesburg(midWeek);
    expect(startsAt.toISOString()).toBe("2025-10-19T22:00:00.000Z"); // Mon 00:00 SAST
    expect(endsAt.toISOString()).toBe("2025-10-26T22:00:00.000Z"); // next Mon 00:00 SAST
  });

  it("puts Sunday in the week that started the previous Monday", () => {
    const sunday = new Date("2025-10-26T10:00:00.000Z"); // Sun 12:00 SAST
    const { startsAt } = weekWindowJohannesburg(sunday);
    expect(johannesburgDateKey(startsAt)).toBe("2025-10-20");
  });

  it("lists Mon–Sun date keys for the week", () => {
    const keys = weekDayKeysJohannesburg(new Date("2025-10-22T13:00:00.000Z"));
    expect(keys).toEqual([
      "2025-10-20",
      "2025-10-21",
      "2025-10-22",
      "2025-10-23",
      "2025-10-24",
      "2025-10-25",
      "2025-10-26",
    ]);
  });

  it("builds an exclusive day window in SAST", () => {
    const { startsAt, endsAt } = dayWindowJohannesburg("2025-10-22");
    expect(startsAt.toISOString()).toBe("2025-10-21T22:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2025-10-22T22:00:00.000Z");
  });

  it("accepts a YYYY-MM-DD weekOf string", () => {
    const { startsAt } = weekWindowJohannesburg("2025-10-25");
    expect(johannesburgDateKey(startsAt)).toBe("2025-10-20");
  });
});
