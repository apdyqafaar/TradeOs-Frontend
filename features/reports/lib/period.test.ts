import { describe, expect, it } from "vitest";
import {
  formatPeriodEcho,
  hasUnusableRange,
  type ReportPeriod,
  toPeriodParams,
} from "./period";

const period = (overrides: Partial<ReportPeriod> = {}): ReportPeriod => ({
  period: "month",
  from: "",
  to: "",
  ...overrides,
});

describe("toPeriodParams", () => {
  it("sends a preset as the single `period` key", () => {
    expect(toPeriodParams(period({ period: "year" }))).toEqual({
      period: "year",
    });
  });

  it("keeps a stale range out of a preset request", () => {
    // The dates stay in the URL so switching back to Custom finds them, but
    // sending `period` and `from`/`to` together is a 422
    // (`common.validation.ts:82-84`).
    expect(
      toPeriodParams(
        period({ period: "week", from: "2026-09-01", to: "2026-09-07" }),
      ),
    ).toEqual({ period: "week" });
  });

  it("sends a complete custom range as two inclusive calendar dates", () => {
    // Both ends inclusive. A client that "compensated" for the server's
    // exclusive `$lt` by sending `to + 1` would over-select by a whole day
    // (`docs/contracts/reports.md` §1.4).
    expect(
      toPeriodParams(
        period({ period: "custom", from: "2026-09-01", to: "2026-09-07" }),
      ),
    ).toEqual({ from: "2026-09-01", to: "2026-09-07" });
  });

  it("falls back to the month preset rather than posting a known 400", () => {
    const half = period({ period: "custom", from: "2026-09-01" });
    const reversed = period({
      period: "custom",
      from: "2026-09-07",
      to: "2026-09-01",
    });
    const impossible = period({
      period: "custom",
      from: "2026-02-31",
      to: "2026-03-05",
    });
    // 367 inclusive days — the cap is 366 and the guard is `days + 1 > 366`,
    // so this is the first span that fails.
    const tooLong = period({
      period: "custom",
      from: "2025-01-01",
      to: "2026-01-02",
    });

    for (const state of [half, reversed, impossible, tooLong]) {
      expect(toPeriodParams(state)).toEqual({ period: "month" });
      expect(hasUnusableRange(state)).toBe(true);
    }
  });

  it("accepts exactly 366 inclusive days", () => {
    // 2025-01-01 to 2026-01-01 is 366 days counting both ends: the largest
    // range the API will take.
    const state = period({
      period: "custom",
      from: "2025-01-01",
      to: "2026-01-01",
    });
    expect(hasUnusableRange(state)).toBe(false);
    expect(toPeriodParams(state)).toEqual({
      from: "2025-01-01",
      to: "2026-01-01",
    });
  });
});

describe("formatPeriodEcho", () => {
  it("shows the last INCLUDED day, not the exclusive bound", () => {
    // The echo's `to` is the exclusive bound as an ISO instant: local midnight
    // on the 4th in Nairobi is 21:00Z on the 3rd, and the window the reader
    // asked for ended on the 3rd (§1.6). Printing `formatDate(echo.to)` would
    // name a day the report did not cover.
    expect(
      formatPeriodEcho(
        {
          from: "2026-08-31T21:00:00.000Z",
          to: "2026-09-03T21:00:00.000Z",
          timezone: "Africa/Nairobi",
        },
        "Africa/Nairobi",
      ),
    ).toBe("01 Sep 2026 – 03 Sep 2026");
  });

  it("collapses a single day to one date", () => {
    expect(
      formatPeriodEcho(
        {
          from: "2026-09-09T21:00:00.000Z",
          to: "2026-09-10T21:00:00.000Z",
          timezone: "Africa/Nairobi",
        },
        "Africa/Nairobi",
      ),
    ).toBe("10 Sep 2026");
  });

  it("reads the window in the business zone, not the browser's", () => {
    // The same instants in UTC name different calendar days. The zone is the
    // organization's and is never the reader's.
    expect(
      formatPeriodEcho(
        {
          from: "2026-08-31T21:00:00.000Z",
          to: "2026-09-03T21:00:00.000Z",
          timezone: "Africa/Nairobi",
        },
        "UTC",
      ),
    ).toBe("31 Aug 2026 – 03 Sep 2026");
  });
});
