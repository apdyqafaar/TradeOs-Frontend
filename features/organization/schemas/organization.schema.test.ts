import { describe, expect, it } from "vitest";
import { createOrganizationSchema } from "./organization.schema";

describe("createOrganizationSchema", () => {
  it("accepts a complete business", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Spark Trading Ltd",
      timezone: "Africa/Nairobi",
      mainCurrency: "USD",
      exchangeCurrency: "KES",
      exchangeRate: 130,
    });
    expect(result.success).toBe(true);
  });

  it("requires a 3-letter ISO currency code", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Spark Trading Ltd",
      timezone: "Africa/Nairobi",
      mainCurrency: "DOLLARS",
      exchangeCurrency: "KES",
      exchangeRate: 130,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive exchange rate — the backend has no default", () => {
    for (const exchangeRate of [0, -1]) {
      const result = createOrganizationSchema.safeParse({
        name: "Spark Trading Ltd",
        timezone: "Africa/Nairobi",
        mainCurrency: "USD",
        exchangeCurrency: "KES",
        exchangeRate,
      });
      expect(result.success, `rate ${exchangeRate} should be rejected`).toBe(
        false,
      );
    }
  });
});
