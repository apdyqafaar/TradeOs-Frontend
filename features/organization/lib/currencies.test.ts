import { describe, expect, it } from "vitest";
import { CURRENCIES, ensureCurrencyOption } from "./currencies";
import { describeTimezone, isSupportedTimezone, TIMEZONES } from "./timezones";

describe("the currency catalog", () => {
  it("holds only well-formed ISO-4217 codes", () => {
    // The API shape-checks with /^[A-Z]{3}$/ and nothing more, so a typo here
    // would be stored happily and then label every amount the business ever
    // records with a currency that does not exist.
    for (const option of CURRENCIES) {
      expect(option.code, option.name).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("lists each code once", () => {
    const codes = CURRENCIES.map((option) => option.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("keeps a code the catalog does not list selectable", () => {
    // Otherwise opening the currency tab on a business set to an unlisted code
    // shows an empty select, and saving — which submits all three fields
    // together, by design — overwrites a working configuration with whatever
    // sorts first.
    const options = ensureCurrencyOption("XAF");
    expect(options[0]?.code).toBe("XAF");
    expect(options).toHaveLength(CURRENCIES.length + 1);
  });

  it("does not duplicate a code the catalog already has", () => {
    expect(ensureCurrencyOption("kes")).toHaveLength(CURRENCIES.length);
    expect(ensureCurrencyOption("KES")).toHaveLength(CURRENCIES.length);
  });

  it("returns the catalog unchanged for an empty code", () => {
    // The loading state of `useCurrencyConfig` is `""`, not a plausible code.
    expect(ensureCurrencyOption("")).toHaveLength(CURRENCIES.length);
  });
});

describe("the timezone picker", () => {
  it("offers real zones, sorted, including a common one", () => {
    expect(TIMEZONES.length).toBeGreaterThan(10);
    expect([...TIMEZONES]).toEqual(
      [...TIMEZONES].sort((a, b) => a.localeCompare(b)),
    );
    expect(TIMEZONES).toContain("Africa/Nairobi");
  });

  it("accepts a zone Intl can resolve and refuses one it cannot", () => {
    expect(isSupportedTimezone("Africa/Nairobi")).toBe(true);
    expect(isSupportedTimezone("UTC")).toBe(true);
    // `new Intl.DateTimeFormat("en-US", { timeZone: "Not/AZone" })` throws a
    // RangeError, which is the same failure a stored garbage zone produces
    // downstream in `TZDate` — where it surfaces as `getTime() === NaN` and an
    // empty report rather than an error.
    expect(isSupportedTimezone("Not/AZone")).toBe(false);
    expect(isSupportedTimezone("")).toBe(false);
  });

  it("labels a zone with its offset, which is what people recognise", () => {
    const label = describeTimezone("Africa/Nairobi");
    expect(label).toContain("Africa / Nairobi");
    expect(label).toMatch(/GMT[+-]\d/);
  });

  it("falls back to the bare name for a zone it cannot describe", () => {
    expect(describeTimezone("Not/AZone")).toBe("Not / AZone");
  });
});
