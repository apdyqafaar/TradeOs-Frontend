import { describe, expect, it } from "vitest";
import {
  createProductSchema,
  stockMovementSchema,
  updateProductSchema,
} from "./product.schema";

const valid = {
  name: "Basmati rice 5 kg",
  unit: "kg",
  costPrice: 9.1,
  sellingPrice: 12.4,
  trackStock: true,
};

/** A 24-character hex string, the only id shape this API accepts. */
const OBJECT_ID = "6520f0f0f0f0f0f0f0f0f0f0";

describe("createProductSchema", () => {
  it("accepts a product with no barcode and no category", () => {
    // Both are optional: an omitted category means the seeded General.
    expect(createProductSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a barcode with a space or under four characters", () => {
    for (const barcode of ["ab", "12 34"]) {
      expect(
        createProductSchema.safeParse({ ...valid, barcode }).success,
        barcode,
      ).toBe(false);
    }
  });

  it("rejects money with more than two decimals", () => {
    expect(
      createProductSchema.safeParse({ ...valid, sellingPrice: 12.456 }).success,
    ).toBe(false);
  });

  it("allows a three-decimal quantity, because goods are sold by weight", () => {
    expect(
      createProductSchema.safeParse({ ...valid, quantity: 1.505 }).success,
    ).toBe(true);
  });

  it("rejects a fractional low-stock threshold — it is a whole-unit alarm", () => {
    expect(
      createProductSchema.safeParse({ ...valid, lowStockThreshold: 2.5 })
        .success,
    ).toBe(false);
  });

  it("fills in the three defaults the backend fills in", () => {
    // `unit`, `trackStock` and `quantity` all carry defaults in
    // ../Backend/src/validators/product.validation.ts, so a form that omits
    // them sends exactly what the API would have assumed.
    const parsed = createProductSchema.safeParse({
      name: "Delivery fee",
      costPrice: 0,
      sellingPrice: 500,
    });
    expect(parsed.success && parsed.data).toMatchObject({
      unit: "pcs",
      trackStock: true,
      quantity: 0,
    });
  });

  it("rejects a negative quantity but allows exactly zero", () => {
    // The backend's refinement is `n === 0 || isQuantity(n)`, and `isQuantity`
    // is strictly positive — zero is admitted by the first branch only.
    expect(
      createProductSchema.safeParse({ ...valid, quantity: 0 }).success,
    ).toBe(true);
    expect(
      createProductSchema.safeParse({ ...valid, quantity: -1 }).success,
    ).toBe(false);
  });

  it("takes at most five image ids, and only real ids", () => {
    expect(
      createProductSchema.safeParse({
        ...valid,
        images: Array(5).fill(OBJECT_ID),
      }).success,
    ).toBe(true);
    expect(
      createProductSchema.safeParse({
        ...valid,
        images: Array(6).fill(OBJECT_ID),
      }).success,
    ).toBe(false);
    expect(
      createProductSchema.safeParse({ ...valid, images: ["not-an-id"] })
        .success,
    ).toBe(false);
  });

  it("refuses a key the API would refuse — the body is strict", () => {
    // `createProductSchema` is `.strict()` on the backend, so `status` or a
    // stray `organizationId` is a 422, not a silently ignored field.
    expect(
      createProductSchema.safeParse({ ...valid, status: "active" }).success,
    ).toBe(false);
  });
});

describe("updateProductSchema", () => {
  it("is not a partial of create: it adds `status` and keeps `quantity`", () => {
    // `status` only ever un-archives — the enum has one member — and
    // `quantity` survives the `.partial()` because a PATCH that flips
    // `trackStock` false -> true carries the opening stock with it.
    expect(updateProductSchema.safeParse({ status: "active" }).success).toBe(
      true,
    );
    expect(updateProductSchema.safeParse({ status: "archived" }).success).toBe(
      false,
    );
    expect(
      updateProductSchema.safeParse({ trackStock: true, quantity: 12 }).success,
    ).toBe(true);
  });

  it("rejects an empty body, because there is nothing to update", () => {
    expect(updateProductSchema.safeParse({}).success).toBe(false);
  });

  it("sends only what changed — no default is smuggled into a PATCH", () => {
    // Regression guard. The backend's own update schema is built the same way
    // and DOES leak `unit: "pcs"` and `trackStock: true` into every partial
    // body, because Zod 4's `.partial()` keeps a `.default()` alive inside the
    // optional. Re-declaring those two without their defaults is what keeps
    // this true; "simplifying" it back makes a rename reset the unit.
    const parsed = updateProductSchema.safeParse({ name: "Renamed" });
    expect(parsed.success && parsed.data).toEqual({ name: "Renamed" });
  });

  it("keeps every bound the create schema has", () => {
    expect(updateProductSchema.safeParse({ costPrice: 1.234 }).success).toBe(
      false,
    );
    expect(updateProductSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("stockMovementSchema", () => {
  it("requires a reason for an adjustment but not for a restock", () => {
    expect(
      stockMovementSchema.safeParse({ type: "restock", quantity: 10 }).success,
    ).toBe(true);
    expect(
      stockMovementSchema.safeParse({ type: "adjustment", quantity: -3 })
        .success,
    ).toBe(false);
    expect(
      stockMovementSchema.safeParse({
        type: "adjustment",
        quantity: -3,
        reason: "Damaged in transit",
      }).success,
    ).toBe(true);
  });

  it("refuses a zero adjustment, which would record a movement that moved nothing", () => {
    expect(
      stockMovementSchema.safeParse({
        type: "adjustment",
        quantity: 0,
        reason: "x",
      }).success,
    ).toBe(false);
  });

  it("refuses a negative restock — a restock only ever adds", () => {
    // `restock` uses `quantitySchema`, which is strictly positive; taking
    // stock out is what `adjustment` is for, and it demands a reason.
    expect(
      stockMovementSchema.safeParse({ type: "restock", quantity: -5 }).success,
    ).toBe(false);
    expect(
      stockMovementSchema.safeParse({ type: "restock", quantity: 0 }).success,
    ).toBe(false);
  });

  it("accepts only the two types a person can send", () => {
    // `sale` and `sale_void` are movement types the API writes itself; they
    // are not accepted on POST /products/:id/stock.
    expect(
      stockMovementSchema.safeParse({ type: "sale", quantity: -1 }).success,
    ).toBe(false);
  });

  it("says which field is missing when an adjustment has no reason", () => {
    // The message matters: the stock dialog surfaces it under the field, and
    // "Invalid input: expected string, received undefined" is not an answer.
    const parsed = stockMovementSchema.safeParse({
      type: "adjustment",
      quantity: -3,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(["reason"]);
      expect(parsed.error.issues[0]?.message).toMatch(/reason is required/i);
    }
  });
});
