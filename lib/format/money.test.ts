import { describe, expect, it } from "vitest";
import {
  formatExchange,
  formatMoney,
  formatQuantity,
} from "@/lib/format/money";

describe("formatMoney", () => {
  it("uses the currency code and always two decimals", () => {
    expect(formatMoney(1250, "USD")).toBe("USD 1,250.00");
    expect(formatMoney(1250.5, "USD")).toBe("USD 1,250.50");
    expect(formatMoney(0, "KES")).toBe("KES 0.00");
  });

  it("groups thousands", () => {
    expect(formatMoney(1234567.89, "USD")).toBe("USD 1,234,567.89");
  });

  it("rounds to two decimals rather than showing the third", () => {
    expect(formatMoney(0.125, "USD")).toBe("USD 0.13");
    expect(formatMoney(0.124, "USD")).toBe("USD 0.12");
  });

  it("never renders NaN or Infinity onto a receipt", () => {
    expect(formatMoney(Number.NaN, "USD")).toBe("USD 0.00");
    expect(formatMoney(Number.POSITIVE_INFINITY, "USD")).toBe("USD 0.00");
  });
});

describe("formatQuantity", () => {
  it("shows up to three decimals, trimmed", () => {
    expect(formatQuantity(2)).toBe("2");
    expect(formatQuantity(1.5)).toBe("1.5");
    expect(formatQuantity(0.25)).toBe("0.25");
    expect(formatQuantity(0.125)).toBe("0.125");
    // 0.250 is the same number as 0.25; the trailing zero cannot survive.
    expect(formatQuantity(0.25)).toBe("0.25");
  });

  it("does not invent a fourth decimal", () => {
    expect(formatQuantity(1.2345)).toBe("1.235");
  });

  it("appends the unit when there is one", () => {
    expect(formatQuantity(1.5, "kg")).toBe("1.5 kg");
    expect(formatQuantity(12, "pcs")).toBe("12 pcs");
    expect(formatQuantity(1200, "bag")).toBe("1,200 bag");
  });
});

describe("formatExchange", () => {
  it("gives the tendered line and the conversion back to the main currency", () => {
    // USD main, KES exchange at 130: KES 5,000 is USD 38.46.
    expect(formatExchange(5000, "KES", 130, "USD")).toEqual({
      tendered: "KES 5,000.00",
      converted: "≈ USD 38.46 @ 130",
    });
  });

  it("shows a fractional rate without padding it", () => {
    expect(formatExchange(100, "EUR", 0.92, "USD")).toEqual({
      tendered: "EUR 100.00",
      converted: "≈ USD 108.70 @ 0.92",
    });
  });

  it("omits the conversion rather than dividing by an unusable rate", () => {
    expect(formatExchange(5000, "KES", 0, "USD").converted).toBeNull();
    expect(formatExchange(5000, "KES", Number.NaN, "USD").converted).toBeNull();
    expect(formatExchange(5000, "KES", -1, "USD").tendered).toBe(
      "KES 5,000.00",
    );
  });
});
