import { describe, expect, it } from "vitest";
import {
  defaultCustomRange,
  formatDigestPeriod,
  inclusiveEnd,
} from "@/features/insights/lib/period";
import type { DigestPeriod } from "@/features/insights/types";

const MOGADISHU = "Africa/Mogadishu"; // UTC+3, no DST.

/**
 * A run on Monday 14 Sep 2026 asking for the last 7 days. The API resolves it
 * in the shop's zone and answers `to` = local midnight opening the 15th, which
 * is 2026-09-14T21:00Z at UTC+3.
 */
const lastSeven: DigestPeriod = {
  preset: "last7",
  from: "2026-09-07T21:00:00.000Z",
  to: "2026-09-14T21:00:00.000Z",
};

describe("the exclusive `to`", () => {
  it("names the last day the window covers, which is a day BEFORE `to`", () => {
    // The whole reason this function exists. `to` is the instant one calendar
    // day after the last day included, so a reader printing it renders
    // "08 – 15 Sep" for a window that stops on the 14th — a plausible date,
    // wrong by one, on every range label on the page.
    // Compared as an instant, not as a formatted string: `subDays` with a zone
    // returns a `TZDate`, whose `toISOString()` prints the shop's offset rather
    // than `Z` for the very same moment.
    expect(inclusiveEnd(lastSeven, MOGADISHU).getTime()).toBe(
      new Date("2026-09-13T21:00:00.000Z").getTime(),
    );
  });

  it("prints the range the canvas draws", () => {
    expect(formatDigestPeriod(lastSeven, MOGADISHU)).toBe(
      "Last 7 days · 08 – 14 Sep 2026",
    );
  });

  it("takes the boundary in the SHOP's timezone, not the reader's", () => {
    // `to` is a local midnight. Subtracting a day from it in a browser set to
    // another zone lands on a different calendar date — the same class of bug
    // `formatLocalDate` exists to prevent one screen over.
    const newYork: DigestPeriod = {
      preset: "last7",
      // Midnight 08 Sep through midnight 15 Sep, America/New_York (UTC−4).
      from: "2026-09-08T04:00:00.000Z",
      to: "2026-09-15T04:00:00.000Z",
    };
    expect(formatDigestPeriod(newYork, "America/New_York")).toBe(
      "Last 7 days · 08 – 14 Sep 2026",
    );
  });
});

describe("formatDigestPeriod", () => {
  it("gives today its weekday — an owner places 'Monday' faster than a date", () => {
    expect(
      formatDigestPeriod(
        {
          preset: "today",
          from: "2026-09-13T21:00:00.000Z",
          to: "2026-09-14T21:00:00.000Z",
        },
        MOGADISHU,
      ),
    ).toBe("Today · Monday, 14 Sep 2026");
  });

  it("collapses a one-day custom range rather than printing '14 – 14 Sep 2026'", () => {
    expect(
      formatDigestPeriod(
        {
          preset: "custom",
          from: "2026-09-13T21:00:00.000Z",
          to: "2026-09-14T21:00:00.000Z",
        },
        MOGADISHU,
      ),
    ).toBe("Custom · 14 Sep 2026");
  });

  it("repeats the year on the start date only when the range crosses one", () => {
    expect(
      formatDigestPeriod(
        {
          preset: "custom",
          from: "2025-12-27T21:00:00.000Z",
          to: "2026-01-05T21:00:00.000Z",
        },
        MOGADISHU,
      ),
    ).toBe("Custom · 28 Dec 2025 – 05 Jan 2026");
  });

  it("is null for a row written before the field existed, rather than inventing 'Today'", () => {
    // `publicDigest` omits the key for those rows precisely so a client cannot
    // tell a guess from a fact. The caller falls back to `localDate`.
    expect(formatDigestPeriod(undefined, MOGADISHU)).toBeNull();
  });
});

describe("defaultCustomRange", () => {
  it("offers the seven days ending today, as bare calendar dates", () => {
    // Bare `yyyy-MM-dd` is what `POST /digests/run` takes, and seven days
    // inclusive means the start is six days back, not seven.
    expect(
      defaultCustomRange(MOGADISHU, new Date("2026-09-14T18:02:00.000Z")),
    ).toEqual({ from: "2026-09-08", to: "2026-09-14" });
  });

  it("resolves 'today' in the shop's day, not the reader's", () => {
    // 22:30 UTC on the 14th is already the 15th in Mogadishu (UTC+3), and the
    // shop's own day is the one the digest is about.
    expect(
      defaultCustomRange(MOGADISHU, new Date("2026-09-14T22:30:00.000Z")),
    ).toEqual({ from: "2026-09-09", to: "2026-09-15" });
  });
});
