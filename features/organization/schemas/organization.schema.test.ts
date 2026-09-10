import { describe, expect, it } from "vitest";
import {
  createOrganizationSchema,
  updateCurrencySchema,
  updateOrganizationSchema,
} from "./organization.schema";

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

/**
 * The two Settings schemas. Both mirror a backend validator, and both add
 * exactly one rule the backend does not have — which is the part worth testing,
 * because a mirror that only repeats the API is only useful for saving a round
 * trip, while these two prevent damage the API would happily accept.
 */
describe("updateOrganizationSchema", () => {
  const valid = {
    name: "Spark Trading Ltd",
    timezone: "Africa/Nairobi",
    phone: "+254 720 118 400",
    address: "Biashara St, Nairobi",
  };

  it("accepts the four editable fields", () => {
    expect(updateOrganizationSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an empty phone and address, because that is how they are cleared", () => {
    // Both are min 0 upstream. A `.min(1)` here would make a business unable to
    // remove a phone number it no longer uses.
    const result = updateOrganizationSchema.safeParse({
      ...valid,
      phone: "",
      address: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a timezone the runtime cannot resolve", () => {
    // The backend validates this now (commit 5179756), but a garbage zone used
    // to be stored silently and then made every period-scoped read NaN. The
    // picker cannot produce one; this rule catches one that arrived otherwise.
    const result = updateOrganizationSchema.safeParse({
      ...valid,
      timezone: "Not/AZone",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a null logoUploadId, which detaches the current logo", () => {
    const result = updateOrganizationSchema.safeParse({
      ...valid,
      logoUploadId: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a logoUploadId that is not a 24-hex id", () => {
    const result = updateOrganizationSchema.safeParse({
      ...valid,
      logoUploadId: "not-an-id",
    });
    expect(result.success).toBe(false);
  });

  it("strips the currency keys, which this route does not own", () => {
    const result = updateOrganizationSchema.safeParse({
      ...valid,
      mainCurrency: "USD",
      exchangeRate: 130,
      slug: "hacked",
      ownerId: "someone-else",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("mainCurrency");
      expect(result.data).not.toHaveProperty("exchangeRate");
      expect(result.data).not.toHaveProperty("slug");
      expect(result.data).not.toHaveProperty("ownerId");
    }
  });
});

describe("updateCurrencySchema", () => {
  it("uppercases the codes, matching what the API stores", () => {
    const result = updateCurrencySchema.safeParse({
      mainCurrency: "  kes ",
      exchangeCurrency: "usd",
      exchangeRate: 130,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mainCurrency).toBe("KES");
      expect(result.data.exchangeCurrency).toBe("USD");
    }
  });

  it("refuses two identical codes, which the API accepts and then ignores", () => {
    // The whole reason this refinement exists. `updateCurrencySchema` upstream
    // has no comparison between the two (proven by running the real validator,
    // docs/contracts/settings-account.md §3), and `resolveRate` tests
    // `currency === config.mainCurrency` FIRST — so with both set to USD every
    // amount resolves at rate 1 and the configured rate becomes dead data that
    // no sale, payment or debt ever applies.
    const result = updateCurrencySchema.safeParse({
      mainCurrency: "USD",
      exchangeCurrency: "USD",
      exchangeRate: 570.5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // On the second field, so the message lands where the fix is.
      expect(result.error.issues[0]?.path).toEqual(["exchangeCurrency"]);
    }
  });

  it('rejects a string rate — `"600"` is a 422 upstream', () => {
    const result = updateCurrencySchema.safeParse({
      mainCurrency: "KES",
      exchangeCurrency: "USD",
      exchangeRate: "600",
    });
    expect(result.success).toBe(false);
  });

  it("rejects NaN with a message about a missing rate, not a missing number", () => {
    // An emptied `<input>` reaches here as NaN, and Zod 4 fails the base type
    // check before `.positive()` runs — without the custom `error` on
    // `z.number()` the person reads "expected number, received NaN".
    const result = updateCurrencySchema.safeParse({
      mainCurrency: "KES",
      exchangeCurrency: "USD",
      exchangeRate: Number.NaN,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Exchange rate is required");
    }
  });

  it("rejects a non-positive rate", () => {
    for (const exchangeRate of [0, -1]) {
      const result = updateCurrencySchema.safeParse({
        mainCurrency: "KES",
        exchangeCurrency: "USD",
        exchangeRate,
      });
      expect(result.success, `rate ${exchangeRate}`).toBe(false);
    }
  });
});
