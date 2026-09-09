import { describe, expect, it } from "vitest";
import {
  isPeriodError,
  MAX_PERIOD_DAYS,
  rangeIssue,
  type SaleFilters,
  toSaleListParams,
} from "./sale-filters";

/**
 * The filter bar's own rendering is three selects; what is worth protecting is
 * the translation between the URL and `GET /sales`, because every mistake in it
 * is a 400 or a 422 rather than a wrong-looking screen — and one of them (the
 * inclusive `to`) is a silently wrong *answer* rather than an error at all.
 */

const filters = (overrides: Partial<SaleFilters> = {}): SaleFilters => ({
  period: "all",
  from: "",
  to: "",
  paymentStatus: "any",
  status: "all",
  customerId: "",
  page: 1,
  limit: 25,
  ...overrides,
});

describe("toSaleListParams", () => {
  it("sends the end date exactly as picked, because `to` is inclusive", () => {
    // The contract's §1 table called `to` exclusive; `resolvePeriod` adds a day
    // itself before the `$lt` (`../Backend/src/lib/period.ts:89-93`), so the
    // caller sends the last day it wants to see. A client "compensating" with
    // `to + 1` would put 01 Oct inside "September" — money from the wrong month
    // on a takings screen, with nothing on screen to show it was wrong.
    const params = toSaleListParams(
      filters({ period: "custom", from: "2026-09-01", to: "2026-09-30" }),
    );

    expect(params.from).toBe("2026-09-01");
    expect(params.to).toBe("2026-09-30");
  });

  it("never sends a preset and a range together", () => {
    // `period` and `from`/`to` are mutually exclusive (422 if both,
    // `common.validation.ts:82-84`), and a URL keeps a stale range around after
    // someone switches back to "This month".
    const params = toSaleListParams(
      filters({ period: "month", from: "2026-09-01", to: "2026-09-30" }),
    );

    expect(params.period).toBe("month");
    expect(params).not.toHaveProperty("from");
    expect(params).not.toHaveProperty("to");
  });

  it("drops a half-filled range rather than posting a guaranteed 400", () => {
    // `from`/`to` must be sent together (`common.validation.ts:85-87`), and the
    // picker is in this state for as long as it takes to click twice.
    const params = toSaleListParams(
      filters({ period: "custom", from: "2026-09-01" }),
    );

    expect(params).not.toHaveProperty("from");
    expect(params).not.toHaveProperty("to");
    expect(params).not.toHaveProperty("period");
  });

  it("sends no date key at all for 'All time'", () => {
    const params = toSaleListParams(filters());

    expect(params).not.toHaveProperty("period");
    expect(params).not.toHaveProperty("from");
  });

  it("omits the filters whose 'off' value the schema does not know", () => {
    // `paymentStatus` has no "any" member and `customerId` is an ObjectId, so
    // both are absent keys rather than empty ones — and because these params
    // are also the React Query key, an explicit `undefined` would be a second
    // cache entry for an identical request.
    const params = toSaleListParams(filters());

    expect(params).not.toHaveProperty("paymentStatus");
    expect(params).not.toHaveProperty("customerId");
    // `status` is the exception: "all" is a real API value and the server's own
    // default, so it is sent and the request stays self-describing.
    expect(params.status).toBe("all");
  });
});

describe("rangeIssue", () => {
  it("accepts a range of exactly the maximum span", () => {
    // The server's test is `days + 1 > MAX_PERIOD_DAYS`, so 366 inclusive days
    // pass. 2026-01-01 → 2027-01-01 is 365 days apart, 366 counting both ends.
    expect(rangeIssue("2026-01-01", "2027-01-01")).toBeNull();
    expect(MAX_PERIOD_DAYS).toBe(366);
  });

  it("refuses one day more than the maximum", () => {
    // The cap is documented nowhere on the frontend side and makes a
    // "last 2 years" range impossible; caught here so the reader is told
    // instead of being handed a 400 whose code is not in `API_ERROR_CODE`.
    expect(rangeIssue("2026-01-01", "2027-01-02")).toBe("too-long");
  });

  it("refuses a reversed range", () => {
    expect(rangeIssue("2026-09-30", "2026-09-01")).toBe("reversed");
  });

  it("refuses a date that is shaped right but is not on the calendar", () => {
    // `2026-02-31` passes the server's regex and fails its calendar check with
    // 400 INVALID_DATE. `new Date("2026-02-31")` is March 3rd in some engines,
    // which is why the check is a UTC field-by-field round trip.
    expect(rangeIssue("2026-02-31", "2026-03-05")).toBe("invalid");
  });

  it("calls a single date incomplete rather than invalid", () => {
    expect(rangeIssue("2026-09-01", "")).toBe("incomplete");
  });
});

describe("isPeriodError", () => {
  it("recognises the three 400s that are missing from API_ERROR_CODE", () => {
    expect(isPeriodError({ status: 400, code: "PERIOD_TOO_LONG" })).toBe(true);
    expect(isPeriodError({ status: 400, code: "INVALID_PERIOD" })).toBe(true);
    expect(isPeriodError({ status: 400, code: "INVALID_DATE" })).toBe(true);
  });

  it("does not swallow other failures", () => {
    // A 400 with a different code, or the same code at another status, is
    // somebody else's problem and still deserves a retry button.
    expect(isPeriodError({ status: 400, code: "BAD_REQUEST" })).toBe(false);
    expect(isPeriodError({ status: 500, code: "INVALID_DATE" })).toBe(false);
  });
});
