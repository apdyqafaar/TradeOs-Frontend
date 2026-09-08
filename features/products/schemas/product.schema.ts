import { z } from "zod";

/**
 * MIRROR OF `../Backend/src/validators/product.validation.ts`.
 *
 * Every bound below is copied from that file (and from the helpers it imports,
 * `common.validation.ts` and `lib/money.ts`) so the browser refuses what the
 * API would refuse. This schema is not the authority — the API validates again
 * and answers a 422 whose `errors` map the form feeds into `setError`. When the
 * backend validator changes, change this file in the same commit.
 *
 * `strictObject`, not `object`: the backend's product bodies really are
 * `.strict()`, so an unknown key is a 422 rather than a quietly dropped field.
 * (This differs from `features/organization`, whose backend counterpart is a
 * plain object — the choice is per-resource, not a house style.)
 */

/** Every id in this API is a MongoDB ObjectId — 24 hex characters. */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Not a valid id");

/**
 * The two magnitude ceilings from `../Backend/src/lib/money.ts`. They exist to
 * stop a typo'd extra zero becoming data nobody can represent, and they are
 * mirrored rather than approximated because a value the browser accepts and
 * the API rejects is the one failure this file exists to prevent.
 */
const MAX_MONEY = 1e12;
const MAX_QUANTITY = 1e9;

/**
 * `isMoney` / `isQuantity`, transcribed. The decimal test is
 * `|n * 10^d - round(n * 10^d)| < 1e-6` rather than a `multipleOf`, because
 * binary floats make the modulo test reject honest values (`8.29 % 0.01` is
 * not 0). Refuse rather than round: rounding hides the bug that produced the
 * extra digits, and the server refuses it anyway.
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

/** Strictly positive — zero is not a quantity, and the backend agrees. */
const isQuantity = (value: number): boolean =>
  Number.isFinite(value) &&
  value > 0 &&
  value <= MAX_QUANTITY &&
  hasDecimals(value, 3);

/**
 * A money field. The `error` on `z.number()` itself is load-bearing: an empty
 * `<input type="number">` registered with `valueAsNumber` yields `NaN`, and Zod
 * fails the base type check before any refinement runs — without it the user
 * reads "expected number, received NaN".
 */
const money = (label: string) =>
  z
    .number({ error: `${label} is required` })
    .refine(
      isMoney,
      `${label} must be a non-negative amount with at most 2 decimals`,
    );

/** `0` is admitted by the first branch only; `isQuantity` alone excludes it. */
const openingQuantity = z
  .number({ error: "Quantity is required" })
  .refine(
    (value) => value === 0 || isQuantity(value),
    "Quantity must be zero or a positive number with at most 3 decimals",
  );

const barcode = z
  .string()
  .trim()
  .min(4, "A barcode is at least 4 characters")
  .max(64, "A barcode is at most 64 characters")
  .regex(
    /^[A-Za-z0-9._-]+$/,
    "Use letters, digits, dot, dash or underscore only",
  );

/**
 * Split out of the object below because `updateProductSchema` needs the same
 * rules WITHOUT the `.default("pcs")` — see the comment there.
 */
const unit = z
  .string()
  .trim()
  .min(1, "A unit is required")
  .max(20, "Keep the unit under 20 characters");

/** Required, and the message is shown under the field — see `stockMovementSchema`. */
const reason = z
  .string({ error: "Reason is required" })
  .trim()
  .min(1, "Reason is required")
  .max(500, "Keep the reason under 500 characters");

/**
 * `POST /products`
 *
 * `quantity` here is OPENING stock, written as an `adjustment` movement with
 * the reason "Initial stock" (`createProductBody` in the backend's
 * product.service.ts). It is create-only in spirit — see `updateProductSchema`.
 */
export const createProductSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, "A name is required")
    .max(120, "Keep the name under 120 characters"),
  barcode: barcode.optional(),
  /**
   * Omitted means the organization's seeded **General** category — never null,
   * and never "uncategorised". A foreign id is a 422 `CATEGORY_NOT_FOUND`, so
   * the select must offer only categories from `GET /categories`.
   */
  categoryId: objectId.optional(),
  unit: unit.default("pcs"),
  costPrice: money("Cost price"),
  sellingPrice: money("Selling price"),
  trackStock: z.boolean().default(true),
  quantity: openingQuantity.default(0),
  /**
   * A whole-unit alarm, not a quantity: the backend types it `int()`. A shop
   * that reorders at "2.5 boxes" is describing a quantity, not a threshold.
   */
  lowStockThreshold: z
    .number({ error: "Enter a whole number" })
    .int("Use a whole number")
    .min(0, "Cannot be negative")
    .max(1e9, "That threshold is too large")
    .optional(),
  description: z
    .string()
    .trim()
    .max(2000, "Keep the description under 2000 characters")
    .optional(),
  /** Attached upload ids, max 5, in display order (backend §6.10). */
  images: z.array(objectId).max(5, "At most 5 images").optional(),
});

/**
 * `PATCH /products/:id`
 *
 * **This is deliberately not `createProductSchema.partial()`.** Two rules from
 * `updateProductForOrg` in the backend's product.service.ts shape it:
 *
 *   1. **`quantity` is honoured ONLY when `trackStock` flips false -> true.**
 *      In every other case — including true -> false — it is read off the body
 *      and thrown away, and the product's quantity stays exactly where it was.
 *      Stock moves through `POST /products/:id/stock`, a sale, or a void, and
 *      nothing else, so a quantity box on an edit form for an already-tracked
 *      product is a control that looks like it worked and changed nothing.
 *      The field stays in the schema because the one case that *is* honoured
 *      is real: turning tracking on for a service that became a stocked item
 *      carries its opening count.
 *   2. **`status` accepts only `"active"`.** It exists to UN-archive. Archiving
 *      is `DELETE /products/:id`, so `status: "archived"` is a 422 — send the
 *      delete instead.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE BACKEND, verified 2026-09-08 by running
 * its own `updateProductSchema` (`bun` against
 * `../Backend/src/validators/product.validation.ts`):
 *
 *     updateProductSchema.safeParse({ name: "Renamed" })
 *       -> { name: "Renamed", unit: "pcs", trackStock: true }
 *
 * `.partial()` does NOT remove a `.default()` — Zod 4 wraps the default in the
 * optional, and an absent key still produces the default. So the backend's
 * "partial" body silently carries `unit: "pcs"` and `trackStock: true`, and
 * its `"Nothing to update"` refinement can never fire because the parsed
 * object is never empty. `unit` and `trackStock` are therefore re-declared
 * below WITHOUT their defaults, so what leaves this browser is only what the
 * user actually changed.
 *
 * That does not fix the API — it re-parses the body and re-applies its own
 * defaults, so **every PATCH must send `unit` and `trackStock` explicitly**,
 * carrying the product's current values, or the server resets the unit to
 * "pcs" and turns stock tracking on. See `docs/findings/s2-task-01.md`.
 */
export const updateProductSchema = createProductSchema
  .omit({ quantity: true })
  .partial()
  .extend({
    unit: unit.optional(),
    trackStock: z.boolean().optional(),
    status: z.enum(["active"]).optional(),
    quantity: openingQuantity.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to update",
  });

/**
 * `POST /products/:id/stock`
 *
 * A discriminated union, not one object with conditional rules, because the
 * two movements are different shapes:
 *
 *   - **restock** — strictly positive, reason optional. A delivery arrived.
 *   - **adjustment** — signed and non-zero, reason REQUIRED. A count was wrong,
 *     something broke, something walked. The reason is the audit trail; a
 *     stock figure that changed for no recorded cause is what the movements
 *     table exists to prevent.
 *
 * `sale` and `sale_void` are the other two `StockMovement` types, and they are
 * absent here on purpose: the API writes those itself when a sale is recorded
 * or voided, and this endpoint refuses them.
 */
export const stockMovementSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("restock"),
    quantity: z
      .number({ error: "Quantity is required" })
      .refine(isQuantity, "Enter a positive quantity with at most 3 decimals"),
    reason: reason.optional(),
  }),
  z.strictObject({
    type: z.literal("adjustment"),
    quantity: z
      .number({ error: "Quantity is required" })
      // Zero is refused by the backend too: a movement that moved nothing is a
      // row in the audit trail that says nothing happened.
      .refine(
        (value) => value !== 0 && isQuantity(Math.abs(value)),
        "Enter a non-zero change with at most 3 decimals",
      ),
    reason,
  }),
]);

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type StockMovementInput = z.infer<typeof stockMovementSchema>;
