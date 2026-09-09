import { describe, expect, it } from "vitest";
import {
  createSaleSchema,
  saleItemSchema,
  voidSaleSchema,
} from "./sale.schema";

/**
 * The boundaries where this mirror and
 * `../Backend/src/validators/sale.validation.ts` have to agree.
 *
 * Every case below is a value the browser must refuse *because the API refuses
 * it* — a form that lets one through spends a round trip to be told no, and
 * shows the cashier a server message instead of an inline one.
 */

const PRODUCT_ID = "aaaaaaaaaaaaaaaaaaaaaaa1";
const CUSTOMER_ID = "ccccccccccccccccccccccc1";

const body = (over: Record<string, unknown> = {}) => ({
  items: [{ productId: PRODUCT_ID, quantity: 1 }],
  payment: { currency: "USD", amountTendered: 10 },
  ...over,
});

describe("ids", () => {
  it("takes a 24-hex ObjectId and nothing else", () => {
    expect(
      saleItemSchema.safeParse({ productId: PRODUCT_ID, quantity: 1 }).success,
    ).toBe(true);

    for (const productId of [
      "abc",
      "",
      `${PRODUCT_ID}0`,
      "zzzzzzzzzzzzzzzzzzzzzzzz",
    ]) {
      expect(
        saleItemSchema.safeParse({ productId, quantity: 1 }).success,
        productId,
      ).toBe(false);
    }
  });
});

describe("quantity", () => {
  it("is strictly positive — zero is not a quantity", () => {
    // `isQuantity` is `n > 0` (`../Backend/src/lib/money.ts:42-47`). A zero-
    // quantity line is a 422, not a line worth nothing.
    expect(
      saleItemSchema.safeParse({ productId: PRODUCT_ID, quantity: 0 }).success,
    ).toBe(false);
    expect(
      saleItemSchema.safeParse({ productId: PRODUCT_ID, quantity: -1 }).success,
    ).toBe(false);
  });

  it("allows 3 decimals, for goods sold by weight", () => {
    expect(
      saleItemSchema.safeParse({ productId: PRODUCT_ID, quantity: 0.335 })
        .success,
    ).toBe(true);
  });

  it("refuses a 4th decimal rather than rounding it away", () => {
    expect(
      saleItemSchema.safeParse({ productId: PRODUCT_ID, quantity: 1.2345 })
        .success,
    ).toBe(false);
  });

  it("refuses NaN, which is what an emptied number input yields", () => {
    expect(
      saleItemSchema.safeParse({ productId: PRODUCT_ID, quantity: Number.NaN })
        .success,
    ).toBe(false);
  });

  it("is required — there is no default", () => {
    expect(saleItemSchema.safeParse({ productId: PRODUCT_ID }).success).toBe(
      false,
    );
  });
});

describe("money fields", () => {
  it("accept at most 2 decimals", () => {
    expect(
      saleItemSchema.safeParse({
        productId: PRODUCT_ID,
        quantity: 1,
        unitPrice: 8.29,
      }).success,
    ).toBe(true);
    expect(
      saleItemSchema.safeParse({
        productId: PRODUCT_ID,
        quantity: 1,
        unitPrice: 8.299,
      }).success,
    ).toBe(false);
  });

  it("are non-negative — a negative price is not a discount", () => {
    expect(
      saleItemSchema.safeParse({
        productId: PRODUCT_ID,
        quantity: 1,
        discount: -1,
      }).success,
    ).toBe(false);
  });

  it("accept zero, and an explicit zero survives parsing unchanged", () => {
    const parsed = saleItemSchema.safeParse({
      productId: PRODUCT_ID,
      quantity: 1,
      unitPrice: 0,
    });
    expect(parsed.success && parsed.data.unitPrice).toBe(0);
  });

  it("cap at MAX_MONEY", () => {
    expect(
      saleItemSchema.safeParse({
        productId: PRODUCT_ID,
        quantity: 1,
        unitPrice: 1e12 + 1,
      }).success,
    ).toBe(false);
  });

  /**
   * The backend has `.default(0)` on both discounts; this mirror has
   * `.optional()`. A default here would materialise the key on every parsed
   * line and put `"discount":0` on the wire for a line nobody discounted,
   * defeating the omission `buildSalePayload` does on purpose.
   */
  it("leave an omitted discount absent rather than defaulting it to 0", () => {
    const parsed = saleItemSchema.safeParse({
      productId: PRODUCT_ID,
      quantity: 1,
    });
    expect(parsed.success && "discount" in parsed.data).toBe(false);
    expect(parsed.success && JSON.stringify(parsed.data)).not.toContain(
      "discount",
    );
  });
});

describe("items", () => {
  it("needs at least one line", () => {
    expect(createSaleSchema.safeParse(body({ items: [] })).success).toBe(false);
  });

  it("caps at 100 lines", () => {
    const many = Array.from({ length: 101 }, (_, index) => ({
      // Distinct ids, so this fails on the length and not on the duplicate rule.
      productId: `${"a".repeat(21)}${String(index).padStart(3, "0")}`,
      quantity: 1,
    }));
    expect(createSaleSchema.safeParse(body({ items: many })).success).toBe(
      false,
    );
  });

  /** "One line per product" (`sale.validation.ts:28`) — the cart merges for this. */
  it("refuses the same productId twice", () => {
    const parsed = createSaleSchema.safeParse(
      body({
        items: [
          { productId: PRODUCT_ID, quantity: 1 },
          { productId: PRODUCT_ID, quantity: 2 },
        ],
      }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe("payment", () => {
  it("requires amountTendered — an omitted one is not 'pay in full'", () => {
    expect(
      createSaleSchema.safeParse(body({ payment: { currency: "USD" } }))
        .success,
    ).toBe(false);
  });

  it("requires a 3-letter currency code and upper-cases it", () => {
    const parsed = createSaleSchema.safeParse(
      body({ payment: { currency: " usd ", amountTendered: 10 } }),
    );
    expect(parsed.success && parsed.data.payment.currency).toBe("USD");

    for (const currency of ["US", "USDD", "$"]) {
      expect(
        createSaleSchema.safeParse(
          body({ payment: { currency, amountTendered: 10 } }),
        ).success,
        currency,
      ).toBe(false);
    }
  });
});

describe("dueDate", () => {
  /**
   * `z.string().datetime()` on the backend, `z.iso.datetime()` here — verified
   * identical against zod 4.5.4. Both want a **full ISO-8601 datetime**, and the
   * `from`/`to` query params on `GET /sales` want the opposite: a bare
   * `YYYY-MM-DD`. The two look like the same kind of field and are not.
   */
  it("takes a full ISO datetime", () => {
    const parsed = createSaleSchema.safeParse(
      body({
        customerId: CUSTOMER_ID,
        dueDate: new Date("2026-12-31T00:00:00.000Z").toISOString(),
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("refuses a bare calendar date, which is what a date picker hands back", () => {
    expect(
      createSaleSchema.safeParse(body({ dueDate: "2026-12-31" })).success,
    ).toBe(false);
  });

  /**
   * The trap inside the trap: Zod's `datetime()` defaults to `offset: false`, so
   * only a `Z` suffix is accepted. A formatter that writes a local offset —
   * `format(date, "yyyy-MM-dd'T'HH:mm:ssXXX")` in a shop on UTC+3 — produces a
   * string that looks correct and 422s. Use `date.toISOString()`.
   */
  it("refuses a UTC offset, accepting only a Z suffix", () => {
    expect(
      createSaleSchema.safeParse(body({ dueDate: "2026-12-31T00:00:00+03:00" }))
        .success,
    ).toBe(false);
    expect(
      createSaleSchema.safeParse(body({ dueDate: "2026-12-31T00:00:00Z" }))
        .success,
    ).toBe(true);
  });
});

describe("strictness", () => {
  it("refuses a stray top-level field, even when everything else is valid", () => {
    // The backend body is `.strict()`; a client that helpfully sends the total
    // it computed gets a 422 for the whole sale (`create.test.ts:370-378`).
    expect(createSaleSchema.safeParse(body({ total: 10 })).success).toBe(false);
  });

  it("refuses a stray field on a line", () => {
    expect(
      createSaleSchema.safeParse(
        body({ items: [{ productId: PRODUCT_ID, quantity: 1, name: "Rice" }] }),
      ).success,
    ).toBe(false);
  });

  it("refuses status, soldBy and number — every one of them is server-set", () => {
    for (const field of ["status", "soldBy", "number", "subtotal"]) {
      expect(
        createSaleSchema.safeParse(body({ [field]: "anything" })).success,
        field,
      ).toBe(false);
    }
  });
});

describe("voidSaleSchema", () => {
  it("requires a reason", () => {
    expect(voidSaleSchema.safeParse({}).success).toBe(false);
    expect(voidSaleSchema.safeParse({ reason: "" }).success).toBe(false);
    // Whitespace-only trims to empty, which the backend's `min(1)` refuses too.
    expect(voidSaleSchema.safeParse({ reason: "   " }).success).toBe(false);
  });

  it("trims and bounds the reason at 500", () => {
    const parsed = voidSaleSchema.safeParse({ reason: "  Wrong item  " });
    expect(parsed.success && parsed.data.reason).toBe("Wrong item");
    expect(voidSaleSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(
      false,
    );
  });
});
