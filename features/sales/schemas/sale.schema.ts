import { z } from "zod";

/**
 * MIRROR OF `../Backend/src/validators/sale.validation.ts`.
 *
 * Every bound below is copied from that file (and from the helpers it imports,
 * `common.validation.ts` and `lib/money.ts`) so the browser refuses what the API
 * would refuse. This schema is not the authority — the API validates again and
 * answers a 422 whose `errors` map `fieldErrorsFor` feeds into `setError`. When
 * the backend validator changes, change this file in the same commit.
 *
 * `strictObject`, matching the backend's `.strict()` on both the body and each
 * item: an unexpected key is a 422 there, so it is a parse failure here rather
 * than a silently dropped field. A stray `total` on the body is a 422 even when
 * everything else is valid (`create.test.ts:370-378`).
 *
 * **What this schema cannot check.** The two rules that actually refuse most
 * bad carts — `lineTotal >= 0` and `total >= 0` — are computed in the backend
 * *service* (`sale.service.ts:155-158,174-175`), not in its validator, from
 * numbers this body does not contain. A payload can parse cleanly here and
 * still 422. `cartIssues` in `../store/cart` is the check for those two; run
 * both before posting.
 */

/** Every id in this API is a MongoDB ObjectId — 24 hex characters. */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Not a valid id");

/**
 * The two magnitude ceilings from `../Backend/src/lib/money.ts:12,15`. They
 * exist to stop a typo'd extra zero becoming data nobody can represent, and are
 * mirrored rather than approximated because a value the browser accepts and the
 * API rejects is the one failure this file exists to prevent.
 */
const MAX_MONEY = 1e12;
const MAX_QUANTITY = 1e9;

/**
 * `isMoney` / `isQuantity`, transcribed from `money.ts:34-47`. The decimal test
 * is `|n * 10^d - round(n * 10^d)| < 1e-6` rather than a `multipleOf`, because
 * binary floats make the modulo test reject honest values (`8.29 % 0.01` is not
 * 0). Refuse rather than round: rounding hides the bug that produced the extra
 * digits, and the server refuses it anyway.
 *
 * Duplicated from `features/products/schemas/product.schema.ts`, where the same
 * three helpers are module-private. Copying them is the smaller evil — sharing
 * them would mean one feature's schema importing another's internals, and the
 * numbers are transcriptions of a backend file, not a decision either slice owns.
 */
const hasDecimals = (value: number, places: 2 | 3): boolean => {
  const scale = places === 2 ? 100 : 1000;
  return Math.abs(value * scale - Math.round(value * scale)) < 1e-6;
};

const isMoney = (value: number): boolean =>
  Number.isFinite(value) &&
  value >= 0 &&
  value <= MAX_MONEY &&
  hasDecimals(value, 2);

/** Strictly positive — `0` is not a quantity, and the backend rejects it outright. */
const isQuantity = (value: number): boolean =>
  Number.isFinite(value) &&
  value > 0 &&
  value <= MAX_QUANTITY &&
  hasDecimals(value, 3);

/**
 * A money field. The `error` on `z.number()` itself is load-bearing: an empty
 * `<input type="number">` registered with `valueAsNumber` yields `NaN`, and Zod
 * fails the base type check before any refinement runs — without it the cashier
 * reads "expected number, received NaN".
 */
const money = (label: string) =>
  z
    .number({ error: `${label} is required` })
    .refine(
      isMoney,
      `${label} must be a non-negative amount with at most 2 decimals`,
    );

/**
 * `POST /sales` item (`sale.validation.ts:12-19`).
 *
 * **`discount` is `.optional()` here where the backend has `.default(0)`, and
 * that is deliberate.** A `.default(0)` on this side would *materialise* the key
 * on every parsed line, so `JSON.stringify` would put `"discount":0` on the wire
 * for a line nobody discounted. The server's own default produces exactly the
 * same stored value from an absent key, so sending it is noise — and it would
 * defeat the omission rule `buildSalePayload` implements. Same reasoning for the
 * order-level `discount` below.
 *
 * `unitPrice` has no default on either side: it is genuinely optional, and the
 * substitution (`product.sellingPrice`) happens in the service
 * (`sale.service.ts:153`), so it is `undefined` on the wire, never `0`.
 */
export const saleItemSchema = z.strictObject({
  productId: objectId,
  quantity: z
    .number({ error: "Quantity is required" })
    .refine(isQuantity, "Enter a positive quantity with at most 3 decimals"),
  unitPrice: money("Unit price").optional(),
  discount: money("Discount").optional(),
});

/**
 * `POST /sales` (`sale.validation.ts:21-36`).
 *
 * Three traps are pinned by the fields below and by `sale.schema.test.ts`:
 *
 *  1. `items` is `min(1).max(100)` **and** refuses a repeated `productId` —
 *     "One line per product". The cart merges a re-scanned product into the
 *     existing line for exactly this reason.
 *  2. `payment.amountTendered` has **no default**. Omitting it is a 422; it does
 *     *not* mean "paid in full" (`docs/contracts/sales.md` trap 7).
 *  3. `dueDate` is a full ISO datetime, and Zod's `datetime()` rejects a UTC
 *     **offset** — `2026-09-10T00:00:00+03:00` fails, `…Z` passes. Produce it
 *     with `date.toISOString()`, never with a formatter that writes `XXX`.
 */
export const createSaleSchema = z.strictObject({
  customerId: objectId.optional(),
  items: z
    .array(saleItemSchema)
    .min(1, "Add at least one line")
    .max(100, "A sale holds at most 100 lines")
    .refine(
      (items) =>
        new Set(items.map((item) => item.productId)).size === items.length,
      "One line per product",
    ),
  /** The **order-level** discount, an amount. `.optional()` — see `saleItemSchema`. */
  discount: money("Discount").optional(),
  payment: z.strictObject({
    /**
     * An ISO 4217 **code**, upper-cased and exactly 3 characters. Never a
     * symbol, and never hardcoded: it is the business's `mainCurrency` or its
     * `exchangeCurrency`, both from `useCurrencyConfig()`. Any other code is a
     * 422 keyed `payment.currency` (`sale.service.ts:58-60`).
     */
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .length(3, "Use a 3-letter currency code"),
    /** In `currency`, not in main currency. Required, with no fallback. */
    amountTendered: money("Amount tendered"),
  }),
  /**
   * Required by the server only when the sale is not fully paid, and then it
   * must not be before start-of-today **in the business's timezone**
   * (`sale.service.ts:197-205`). Optional here because a fully-paid sale must
   * not send one; the conditional requirement is the form's job, and the
   * server's 422 arrives keyed `dueDate`.
   */
  dueDate: z.iso
    .datetime({
      error: "Send a full ISO datetime, e.g. new Date(…).toISOString()",
    })
    .optional(),
  note: z
    .string()
    .trim()
    .max(500, "Keep the note under 500 characters")
    .optional(),
});

/**
 * `POST /sales/:id/void` (`sale.validation.ts:51`).
 *
 * `reason` is **required** — an empty or omitted one is a 422
 * (`void.test.ts:155-161`). A void is not reversible and restores stock, so the
 * audit trail is the point.
 */
export const voidSaleSchema = z.strictObject({
  reason: z
    .string({ error: "A reason is required" })
    .trim()
    .min(1, "A reason is required")
    .max(500, "Keep the reason under 500 characters"),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type SaleItemInput = z.infer<typeof saleItemSchema>;
export type VoidSaleInput = z.infer<typeof voidSaleSchema>;

/**
 * The `errors` keys a 422 from `POST /sales` can carry — **the only way to tell
 * these failures apart.**
 *
 * Every one of them arrives as `code: "VALIDATION_ERROR"`: the service never
 * passes a distinct code to `ValidationError`, so `hasCode(error, …)` cannot
 * separate "this customer is required" from "that discount is too big"
 * (`docs/contracts/sales.md` §7, trap 3). Branch on
 * `fieldErrorsFor(error)[SALE_ERROR_FIELD.X]` instead.
 *
 * Two of the five name a computed total rather than an input the cashier
 * touched: `items` reports a *line's* discount exceeding its own total, and
 * `discount` reports the *order-level* one exceeding the subtotal. A blind
 * `setError(key, …)` loop over `fieldErrors` drops both on the floor, so route
 * each key to the control that can actually fix it.
 */
export const SALE_ERROR_FIELD = {
  /** No customer chosen on a sale that is not fully paid. → the customer picker. */
  CUSTOMER: "customerId",
  /** Missing due date, or one before today in the business timezone. → the date picker. */
  DUE_DATE: "dueDate",
  /** The tendered currency is neither the main nor the exchange currency. → the currency toggle. */
  CURRENCY: "payment.currency",
  /** A line's discount exceeds its own total. The message names the product. → the cart lines. */
  ITEMS: "items",
  /** The order-level discount exceeds the subtotal. → the order discount field. */
  DISCOUNT: "discount",
} as const satisfies Record<string, string>;
