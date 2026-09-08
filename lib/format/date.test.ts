import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatRelative,
  formatTime,
} from "@/lib/format/date";

/** UTC+3, no DST — the timezone a Mombasa or Nairobi shop actually runs on. */
const NAIROBI = "Africa/Nairobi";
/** UTC-5 in September, so a late-evening UTC instant is still the same day here. */
const NEW_YORK = "America/New_York";

describe("formatDate", () => {
  it("renders the table format", () => {
    expect(formatDate("2026-09-07T11:32:00.000Z", NAIROBI)).toBe("07 Sep 2026");
  });

  it("resolves the day in the business timezone, not UTC", () => {
    // 22:30 UTC is already the 8th in Nairobi and still the 7th in New York.
    const instant = "2026-09-07T22:30:00.000Z";
    expect(formatDate(instant, NAIROBI)).toBe("08 Sep 2026");
    expect(formatDate(instant, NEW_YORK)).toBe("07 Sep 2026");
    expect(formatDate(instant, "UTC")).toBe("07 Sep 2026");
  });

  it("accepts a Date and a millisecond timestamp as well as a string", () => {
    const instant = new Date("2026-09-07T11:32:00.000Z");
    expect(formatDate(instant, NAIROBI)).toBe("07 Sep 2026");
    expect(formatDate(instant.getTime(), NAIROBI)).toBe("07 Sep 2026");
  });

  it("shows a placeholder rather than 'Invalid Date' in a cell", () => {
    expect(formatDate("not a date", NAIROBI)).toBe("—");
  });
});

describe("formatTime", () => {
  it("is 24-hour and shifted into the business timezone", () => {
    expect(formatTime("2026-09-07T11:32:00.000Z", NAIROBI)).toBe("14:32");
    expect(formatTime("2026-09-07T11:32:00.000Z", "UTC")).toBe("11:32");
  });
});

describe("formatDateTime", () => {
  it("joins the two table formats", () => {
    expect(formatDateTime("2026-09-07T11:32:00.000Z", NAIROBI)).toBe(
      "07 Sep 2026 14:32",
    );
  });

  it("crosses midnight in the business timezone", () => {
    expect(formatDateTime("2026-09-07T22:30:00.000Z", NAIROBI)).toBe(
      "08 Sep 2026 01:30",
    );
  });
});

describe("formatRelative", () => {
  const now = "2026-09-07T12:00:00.000Z";

  it("is compact, in the feed's vocabulary", () => {
    expect(formatRelative("2026-09-07T11:59:30.000Z", NAIROBI, now)).toBe(
      "just now",
    );
    expect(formatRelative("2026-09-07T11:55:00.000Z", NAIROBI, now)).toBe(
      "5 m ago",
    );
    expect(formatRelative("2026-09-07T10:00:00.000Z", NAIROBI, now)).toBe(
      "2 h ago",
    );
    expect(formatRelative("2026-09-05T12:00:00.000Z", NAIROBI, now)).toBe(
      "2 d ago",
    );
  });

  it("falls back to the absolute date once a week has passed", () => {
    expect(formatRelative("2026-08-20T12:00:00.000Z", NAIROBI, now)).toBe(
      "20 Aug 2026",
    );
  });

  it("counts days by the business timezone's calendar", () => {
    // 21:30 UTC on the 6th is 00:30 on the 7th in Nairobi — the same calendar
    // day as `now` there, but the previous one in UTC.
    const lateYesterdayUtc = "2026-09-06T21:30:00.000Z";
    expect(
      formatRelative(lateYesterdayUtc, NAIROBI, "2026-09-07T06:00:00.000Z"),
    ).toBe("8 h ago");
    expect(
      formatRelative(lateYesterdayUtc, NAIROBI, "2026-09-08T06:00:00.000Z"),
    ).toBe("1 d ago");
    expect(
      formatRelative(lateYesterdayUtc, "UTC", "2026-09-08T06:00:00.000Z"),
    ).toBe("2 d ago");
  });

  it("shows a placeholder for an unparseable value", () => {
    expect(formatRelative("nonsense", NAIROBI, now)).toBe("—");
  });
});
