import { describe, expect, it } from "vitest";
import { axisTicks, bucketLabel, moneyIn, percentOf } from "./format";

describe("moneyIn", () => {
  it("renders the code the organization gave, never a symbol", () => {
    expect(moneyIn("KES")(1250)).toBe("KES 1,250.00");
  });

  it("renders a bare number when the business has no currency configured", () => {
    // `useOrganization().currency` is `""` until the answer lands and stays
    // `""` when there is no currency row at all — a real state, because
    // `organization.currency` is nullable on the wire. A guessed "USD" over a
    // Kenyan shop's takings would look completely correct, which is the one
    // failure the no-hardcoded-currency rule exists to prevent.
    expect(moneyIn("")(1250)).toBe("1,250.00");
  });
});

describe("percentOf", () => {
  it("reads a round4 fraction as a percentage", () => {
    // `share` and `marginPct` are fractions despite their names: 0.3769 is
    // 37.69%, and rendering it raw would print "0.38%" over a healthy margin.
    expect(percentOf(0.3769)).toBe("37.7%");
    expect(percentOf(0.8889)).toBe("88.9%");
    expect(percentOf(0)).toBe("0.0%");
  });

  it("survives the divide-by-zero the API already guards", () => {
    expect(percentOf(Number.NaN)).toBe("0.0%");
  });
});

describe("axisTicks", () => {
  it("labels a flat baseline instead of five zeroes", () => {
    // Day one of every business is an all-zero series.
    expect(axisTicks(0)).toEqual(["1", "1", "1", "0", "0"]);
  });

  it("compacts thousands, top first", () => {
    expect(axisTicks(20320)).toEqual(["20.3k", "15.2k", "10.2k", "5.1k", "0"]);
  });
});

describe("bucketLabel", () => {
  it("names the weekday of a day bucket without re-parsing it as an instant", () => {
    // `bucket` is a label the server already resolved in the business
    // timezone. `new Date("2026-09-01")` is UTC midnight and names 31 Aug west
    // of Greenwich, so the parts are rebuilt as a local calendar date.
    expect(bucketLabel("2026-09-01", "day")).toBe("Tue");
  });

  it("leaves week and month buckets as they came", () => {
    // A week bucket is also `yyyy-MM-dd` — the Monday — so "Mon" over every
    // one of them would say nothing, and only the requested granularity can
    // tell the two shapes apart (§3.2).
    expect(bucketLabel("2026-08-31", "week")).toBe("2026-08-31");
    expect(bucketLabel("2026-09", "month")).toBe("2026-09");
  });

  it("falls through on anything that is not three numeric parts", () => {
    expect(bucketLabel("2026-09", "day")).toBe("2026-09");
  });
});
