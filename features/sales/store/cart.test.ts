import { beforeEach, describe, expect, it } from "vitest";
import type { Product } from "@/features/products/types";
import {
  buildSalePayload,
  type CartLine,
  cartIssues,
  cartTotals,
  lineTotal,
  round2,
  useCartStore,
} from "./cart";

/**
 * The cart's arithmetic must equal the server's, to the cent.
 *
 * These are not unit tests of a helper; they are the guard on a claim — that
 * `../Backend/src/services/sale.service.ts:148-180` and this file compute the
 * same numbers from the same input. A disagreement of one cent is a receipt
 * dispute at the counter, and it is invisible until a customer notices, so the
 * cases below are the ones where a plausible reimplementation drifts:
 * `Math.round` without `Number.EPSILON`, and rounding the sum instead of each
 * line.
 */

/** The two fields a `Product` contributes that this store keeps; the rest is scenery. */
const product = (over: Partial<Product> = {}): Product => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaa1",
  name: "Basmati rice",
  category: { id: "bbbbbbbbbbbbbbbbbbbbbbb1", name: "Grains" },
  unit: "kg",
  costPrice: 1.2,
  sellingPrice: 2,
  trackStock: true,
  quantity: 100,
  images: [],
  status: "active",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "aaaaaaaaaaaaaaaaaaaaaaa1",
  name: "Basmati rice",
  unit: "kg",
  listPrice: 2,
  unitPrice: 2,
  quantity: 1,
  discount: 0,
  ...over,
});

const tender = { currency: "USD", amountTendered: 100 };

beforeEach(() => {
  useCartStore.getState().clear();
});

describe("round2", () => {
  /**
   * The whole reason `money.ts:18` adds `Number.EPSILON`. `0.05 * 2.9` lands a
   * hair under `0.145` in binary floating point, so the naive form rounds it
   * DOWN to 0.14 while the server's form rounds it up to 0.15.
   */
  it("matches the server where the naive form loses a cent", () => {
    const raw = 0.05 * 2.9;
    const naive = Math.round(raw * 100) / 100;

    expect(round2(raw)).toBe(0.15);
    expect(naive).toBe(0.14);
    expect(round2(raw)).not.toBe(naive);
  });

  it("rounds a price-times-weight that sits exactly on the boundary", () => {
    // 1.00 per kg, 1.005 kg on the scale. Naive: 1.00. Server: 1.01.
    expect(round2(1 * 1.005)).toBe(1.01);
    expect(Math.round(1 * 1.005 * 100) / 100).toBe(1);
  });

  it("clears accumulated float dust rather than propagating it", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(8.29 * 3)).toBe(24.87);
  });

  /**
   * `Math.round` breaks ties toward `+Infinity`, so the server's own "half away
   * from zero" comment is not true below zero: `round2(-0.005)` is `-0`, and
   * `-0 < 0` is false. That is exactly the boundary where `cartIssues` decides
   * whether to let a sale through, so this cart has to be wrong in the same
   * direction as the server rather than right on its own.
   */
  it("reproduces the server's asymmetry at the negative boundary", () => {
    expect(round2(-0.005) < 0).toBe(false);
    expect(round2(-0.006)).toBe(-0.01);
  });
});

describe("adding a product", () => {
  it("starts the line at the product's selling price", () => {
    useCartStore.getState().addProduct(product({ sellingPrice: 3.5 }));

    const [added] = useCartStore.getState().lines;
    expect(added).toMatchObject({
      productId: "aaaaaaaaaaaaaaaaaaaaaaa1",
      name: "Basmati rice",
      unit: "kg",
      listPrice: 3.5,
      unitPrice: 3.5,
      quantity: 1,
      discount: 0,
    });
  });

  /**
   * `POST /sales` refuses a repeated `productId` outright — "One line per
   * product", `sale.validation.ts:28` — so a second line is not a cosmetic
   * duplicate, it is a 422 for the whole sale. Re-scanning an item at the
   * counter is the ordinary case, not an edge one.
   */
  it("merges a re-scanned product into the existing line", () => {
    const rice = product();
    const { addProduct } = useCartStore.getState();

    addProduct(rice);
    addProduct(rice);
    addProduct(rice, 3);

    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(5);
  });

  it("keeps a price the cashier already negotiated when the product is re-scanned", () => {
    const rice = product();
    useCartStore.getState().addProduct(rice);
    useCartStore.getState().setUnitPrice(rice.id, 1.5);
    useCartStore.getState().setLineDiscount(rice.id, 0.25);

    useCartStore.getState().addProduct(rice);

    expect(useCartStore.getState().lines[0]).toMatchObject({
      unitPrice: 1.5,
      discount: 0.25,
      quantity: 2,
    });
  });

  /**
   * The merge adds two quantities, and `0.1 + 0.2` is `0.30000000000000004`,
   * which `isQuantity` (≤ 3 dp) rejects — the sale would be refused for a
   * quantity nobody typed.
   */
  it("does not let float dust from a merge produce an invalid quantity", () => {
    const sugar = product({ unit: "kg" });
    useCartStore.getState().addProduct(sugar, 0.1);
    useCartStore.getState().addProduct(sugar, 0.2);

    expect(useCartStore.getState().lines[0]?.quantity).toBe(0.3);
  });

  it("keeps distinct products on distinct lines, in the order they were rung up", () => {
    const rice = product();
    const oil = product({ id: "aaaaaaaaaaaaaaaaaaaaaaa2", name: "Oil" });

    useCartStore.getState().addProduct(rice);
    useCartStore.getState().addProduct(oil);
    useCartStore.getState().addProduct(rice);

    const { lines } = useCartStore.getState();
    expect(lines.map((each) => each.productId)).toEqual([
      "aaaaaaaaaaaaaaaaaaaaaaa1",
      "aaaaaaaaaaaaaaaaaaaaaaa2",
    ]);
    expect(lines[0]?.quantity).toBe(2);
  });
});

describe("line and cart totals", () => {
  it("prices a 3-decimal quantity the way the server does", () => {
    // 12.99 per kg, 335 g on the scale: 4.35165 -> 4.35.
    expect(lineTotal(line({ unitPrice: 12.99, quantity: 0.335 }))).toBe(4.35);
  });

  it("subtracts the line discount as an amount, not a percentage", () => {
    expect(lineTotal(line({ unitPrice: 10, quantity: 2, discount: 5 }))).toBe(
      15,
    );
  });

  /**
   * The server rounds **each** line and then rounds the sum
   * (`sale.service.ts:155,173`). Summing the raw products and rounding once —
   * the obvious shortcut — gives 0.25 here where the receipt says 0.26.
   */
  it("rounds per line, not once at the end", () => {
    const half = line({ unitPrice: 0.25, quantity: 0.5 });
    const other = line({
      ...half,
      productId: "aaaaaaaaaaaaaaaaaaaaaaa2",
    });

    expect(lineTotal(half)).toBe(0.13);
    expect(
      cartTotals({ lines: [half, other], orderDiscount: 0 }).subtotal,
    ).toBe(0.26);
    expect(round2(0.25 * 0.5 + 0.25 * 0.5)).toBe(0.25);
  });

  it("applies the order discount after the lines are summed", () => {
    const totals = cartTotals({
      lines: [
        line({ unitPrice: 8.29, quantity: 3 }),
        line({ productId: "aaaaaaaaaaaaaaaaaaaaaaa2", unitPrice: 1.5 }),
      ],
      orderDiscount: 2.37,
    });

    expect(totals).toEqual({
      subtotal: 26.37,
      orderDiscount: 2.37,
      total: 24,
    });
  });

  it("reads an empty cart as zero rather than NaN", () => {
    expect(cartTotals({ lines: [], orderDiscount: 0 })).toEqual({
      subtotal: 0,
      orderDiscount: 0,
      total: 0,
    });
  });
});

describe("cartIssues", () => {
  /**
   * `sale.service.ts:156-158` refuses a negative `lineTotal` with a 422 keyed
   * `errors.items`. The rule lives in the service, not the validator, so
   * `createSaleSchema` cannot see it — this is the only check that can.
   */
  it("names every line whose discount exceeds its own total", () => {
    const bad = line({ unitPrice: 2, quantity: 1, discount: 5 });
    const alsoBad = line({
      productId: "aaaaaaaaaaaaaaaaaaaaaaa2",
      unitPrice: 1,
      quantity: 3,
      discount: 3.01,
    });
    const fine = line({ productId: "aaaaaaaaaaaaaaaaaaaaaaa3" });

    const issues = cartIssues({
      lines: [bad, alsoBad, fine],
      orderDiscount: 0,
    });

    expect(lineTotal(bad)).toBe(-3);
    expect(issues.negativeLines).toEqual([
      "aaaaaaaaaaaaaaaaaaaaaaa1",
      "aaaaaaaaaaaaaaaaaaaaaaa2",
    ]);
    expect(issues.canSubmit).toBe(false);
  });

  it("allows a discount that lands a line exactly on zero", () => {
    const issues = cartIssues({
      lines: [line({ unitPrice: 2, quantity: 1, discount: 2 })],
      orderDiscount: 0,
    });

    // The server's guard is `lineTotal < 0`, not `<= 0` — a free line is legal.
    expect(issues.negativeLines).toEqual([]);
    expect(issues.canSubmit).toBe(true);
  });

  it("reports an order discount larger than the subtotal", () => {
    const issues = cartIssues({
      lines: [line({ unitPrice: 10 })],
      orderDiscount: 10.01,
    });

    expect(issues.orderDiscountExceedsSubtotal).toBe(true);
    expect(issues.canSubmit).toBe(false);
  });

  it("refuses an empty cart, because items is min(1)", () => {
    expect(cartIssues({ lines: [], orderDiscount: 0 })).toMatchObject({
      isEmpty: true,
      canSubmit: false,
    });
  });

  it("passes an ordinary cart", () => {
    expect(
      cartIssues({
        lines: [line({ unitPrice: 4.5, quantity: 2 })],
        orderDiscount: 1,
      }),
    ).toEqual({
      isEmpty: false,
      negativeLines: [],
      orderDiscountExceedsSubtotal: false,
      canSubmit: true,
    });
  });
});

describe("buildSalePayload", () => {
  /**
   * The body is `.strict()` on both the object and each item, and `unitPrice`,
   * `items[].discount` and the order-level `discount` all have server-side
   * defaults or substitutions. Sending `0` and sending nothing store the same
   * value — so the test is that the KEY is absent, not that its value is zero.
   */
  it("omits an unchanged unit price and a zero discount entirely", () => {
    const payload = buildSalePayload(
      {
        lines: [line({ unitPrice: 2, listPrice: 2, quantity: 3 })],
        orderDiscount: 0,
      },
      tender,
    );

    expect(payload.items).toEqual([
      { productId: "aaaaaaaaaaaaaaaaaaaaaaa1", quantity: 3 },
    ]);
    expect(payload.items[0] && "unitPrice" in payload.items[0]).toBe(false);
    expect(payload.items[0] && "discount" in payload.items[0]).toBe(false);
    expect("discount" in payload).toBe(false);

    // What actually reaches the server: the keys must not survive serialisation
    // either, since `JSON.stringify` keeps an explicit `0` and drops nothing.
    const body = JSON.stringify(payload);
    expect(body).not.toContain("unitPrice");
    expect(body).not.toContain("discount");
  });

  it("sends a unit price once it differs from the product's selling price", () => {
    const payload = buildSalePayload(
      {
        lines: [line({ listPrice: 2, unitPrice: 1.75, discount: 0.5 })],
        orderDiscount: 1.25,
      },
      tender,
    );

    expect(payload.items[0]).toEqual({
      productId: "aaaaaaaaaaaaaaaaaaaaaaa1",
      quantity: 1,
      unitPrice: 1.75,
      discount: 0.5,
    });
    expect(payload.discount).toBe(1.25);
  });

  it("sends an override that happens to be lower AND one that is higher", () => {
    const lines = [
      line({ listPrice: 2, unitPrice: 2.5 }),
      line({
        productId: "aaaaaaaaaaaaaaaaaaaaaaa2",
        listPrice: 2,
        unitPrice: 0,
      }),
    ];
    const payload = buildSalePayload({ lines, orderDiscount: 0 }, tender);

    // A zero override is a real price (a giveaway), not an "unset" — it must
    // survive, or the server would substitute the selling price and charge for it.
    expect(payload.items.map((item) => item.unitPrice)).toEqual([2.5, 0]);
  });

  it("carries the tender exactly, in the currency it was taken in", () => {
    const payload = buildSalePayload(
      { lines: [line()], orderDiscount: 0 },
      { currency: "KES", amountTendered: 5000 },
    );

    expect(payload.payment).toEqual({
      currency: "KES",
      amountTendered: 5000,
    });
  });

  it("omits customerId, dueDate and a blank note", () => {
    const payload = buildSalePayload(
      { lines: [line()], orderDiscount: 0 },
      {
        ...tender,
        note: "   ",
      },
    );

    expect("customerId" in payload).toBe(false);
    expect("dueDate" in payload).toBe(false);
    expect("note" in payload).toBe(false);
  });

  it("carries the credit fields when a sale is not fully paid", () => {
    const dueDate = new Date("2026-12-31T00:00:00.000Z").toISOString();
    const payload = buildSalePayload(
      { lines: [line()], orderDiscount: 0 },
      {
        currency: "USD",
        amountTendered: 0,
        customerId: "ccccccccccccccccccccccc1",
        dueDate,
        note: "  Pays on Friday  ",
      },
    );

    expect(payload.customerId).toBe("ccccccccccccccccccccccc1");
    expect(payload.dueDate).toBe(dueDate);
    // Trimmed here as well as server-side, so the value the cart shows on a
    // confirmation is the value the API stores.
    expect(payload.note).toBe("Pays on Friday");
  });

  it("builds one item per line, in cart order, from the live store", () => {
    const rice = product();
    const oil = product({ id: "aaaaaaaaaaaaaaaaaaaaaaa2", sellingPrice: 4 });
    useCartStore.getState().addProduct(rice, 2.5);
    useCartStore.getState().addProduct(oil);
    useCartStore.getState().setOrderDiscount(0.5);

    const payload = buildSalePayload(useCartStore.getState(), tender);

    expect(payload.items).toEqual([
      { productId: "aaaaaaaaaaaaaaaaaaaaaaa1", quantity: 2.5 },
      { productId: "aaaaaaaaaaaaaaaaaaaaaaa2", quantity: 1 },
    ]);
    expect(payload.discount).toBe(0.5);
  });
});

describe("store actions", () => {
  it("removes a line without disturbing the others", () => {
    const rice = product();
    const oil = product({ id: "aaaaaaaaaaaaaaaaaaaaaaa2" });
    useCartStore.getState().addProduct(rice);
    useCartStore.getState().addProduct(oil);

    useCartStore.getState().removeLine(rice.id);

    expect(useCartStore.getState().lines.map((each) => each.productId)).toEqual(
      ["aaaaaaaaaaaaaaaaaaaaaaa2"],
    );
  });

  it("stores a typed quantity exactly, rather than silently rounding it", () => {
    const rice = product();
    useCartStore.getState().addProduct(rice);
    useCartStore.getState().setQuantity(rice.id, 1.2345);

    // Refuse rather than round: the schema and the server both reject 4 dp, and
    // quietly turning it into 1.234 would charge for something nobody chose.
    expect(useCartStore.getState().lines[0]?.quantity).toBe(1.2345);
  });

  it("clears both the lines and the order discount", () => {
    useCartStore.getState().addProduct(product());
    useCartStore.getState().setOrderDiscount(5);

    useCartStore.getState().clear();

    expect(useCartStore.getState()).toMatchObject({
      lines: [],
      orderDiscount: 0,
    });
  });
});
