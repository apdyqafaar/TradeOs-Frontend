"use client";

import { create } from "zustand";
import type { Product } from "@/features/products/types";
import type { ObjectId } from "@/lib/api/types";
import type { CreateSaleInput } from "../schemas/sale.schema";

/**
 * The counter's cart: the lines a cashier has rung up, and the totals derived
 * from them.
 *
 * Client state, so zustand — the lines exist only in this browser until
 * `POST /sales` accepts them, and nothing on the server holds them meanwhile.
 * Nothing here mirrors a server fact: a line carries a *snapshot* of the product
 * it came from, the way the backend's own `ISaleItem` does, so a price edited in
 * another tab mid-shift cannot silently re-price a cart already on screen.
 *
 * **This file must agree with the server to the cent.** Every arithmetic rule
 * below is a transcription of `../Backend/src/services/sale.service.ts:148-180`,
 * and `round2` is a transcription of `../Backend/src/lib/money.ts:18`. A cart
 * that disagrees with the receipt by one cent is a dispute at the counter, so
 * the rounding is tested directly in `cart.test.ts` rather than assumed.
 *
 * The store holds **no derived state**. `subtotal`/`total` are functions of the
 * lines, and a copy kept in the store is a copy that can go stale behind an
 * action that forgot to recompute it. With the React Compiler on, calling
 * `cartTotals(...)` in a render is already memoised — do not add `useMemo`.
 */

/**
 * `round2`, transcribed from `../Backend/src/lib/money.ts:18`, character for
 * character. Do not "improve" it: it is the server's arithmetic, and the point
 * is to produce the server's answer, not the mathematically tidiest one.
 *
 * `Number.EPSILON` is not decoration. `0.05 * 2.9` is `0.145` in binary floats,
 * and a plain `Math.round(0.145 * 100) / 100` gives **0.14** where the server
 * gives **0.15** — one cent, on every such line, in the customer's favour or
 * the shop's depending on the price. Pinned by `cart.test.ts`.
 *
 * Its own comment in `money.ts` calls this "half away from zero". That is true
 * for positives and **not** for negatives: JS `Math.round` breaks ties toward
 * `+Infinity`, so `round2(-0.005)` is `-0`, which is not `< 0` and therefore
 * passes the server's own negative-total guard. Mirroring the formula exactly
 * is what keeps this cart's verdict identical to the server's at that boundary.
 */
export const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * `round3`, from `money.ts:21`. Used in exactly one place — merging two
 * quantities — for a reason spelled out at `addProduct`.
 */
const round3 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1000) / 1000;

/**
 * One rung-up line.
 *
 * Keyed by `productId` and not by a synthetic line id, because `POST /sales`
 * refuses a repeated `productId` outright ("One line per product",
 * `sale.validation.ts:28`). One line per product is not a UI preference here;
 * it is the shape the endpoint accepts.
 */
export interface CartLine {
  productId: ObjectId;
  /** Snapshot of `product.name`, so the line survives a rename mid-shift. */
  name: string;
  /** Snapshot of `product.unit` — `formatQuantity(quantity, unit)`. */
  unit: string;
  /**
   * The product's `sellingPrice` when the line was added.
   *
   * Not shown anywhere on its own; it exists so `buildSalePayload` can tell an
   * *overridden* unit price from an untouched one and omit the untouched case,
   * and so a UI can show "price overridden" without refetching the product.
   */
  listPrice: number;
  /** What this line actually charges per unit. Starts at `listPrice`; overridable. */
  unitPrice: number;
  /** Up to 3 dp, strictly positive. */
  quantity: number;
  /** A line **discount amount**, not a percentage. `0` when none. */
  discount: number;
}

/** The two pieces of cart state every derivation below reads. */
export interface CartContents {
  lines: CartLine[];
  /** The **order-level** discount amount, applied after the lines are summed. */
  orderDiscount: number;
}

export interface CartState extends CartContents {
  /**
   * Rings up a product.
   *
   * Adding the same product twice **increments the existing line's quantity**
   * rather than appending a second line — a second line would make the whole
   * sale a 422, so the merge is the endpoint's rule showing through, not a
   * convenience. A re-scan at the counter is the common case.
   *
   * The merged quantity is passed through `round3` because `0.1 + 0.2` is
   * `0.30000000000000004`, which `isQuantity` rejects (`money.ts:42-47`) — the
   * sale would be refused for a quantity nobody typed. Rounding here cancels
   * float noise from an addition; it never rounds a value the cashier entered
   * (see `setQuantity`).
   *
   * A merge deliberately does **not** reset `unitPrice` or `discount`: re-scanning
   * an item is not a reason to discard the price the cashier just negotiated.
   */
  addProduct: (product: Product, quantity?: number) => void;
  /** Replaces a line's quantity with exactly what was passed. See `addProduct`. */
  setQuantity: (productId: ObjectId, quantity: number) => void;
  /** Overrides the charged price. Pass `listPrice` back to clear the override. */
  setUnitPrice: (productId: ObjectId, unitPrice: number) => void;
  /** Sets the line discount **amount**. */
  setLineDiscount: (productId: ObjectId, discount: number) => void;
  removeLine: (productId: ObjectId) => void;
  setOrderDiscount: (discount: number) => void;
  /** Empties the cart — after a completed sale, or an explicit "clear". */
  clear: () => void;
}

/** Every field a `Product` contributes to a new line, in one place. */
const lineFromProduct = (product: Product, quantity: number): CartLine => ({
  productId: product.id,
  name: product.name,
  unit: product.unit,
  listPrice: product.sellingPrice,
  unitPrice: product.sellingPrice,
  quantity,
  discount: 0,
});

/** Rewrites one line in place, leaving the array's order untouched. */
const patchLine = (
  lines: CartLine[],
  productId: ObjectId,
  patch: Partial<CartLine>,
): CartLine[] =>
  lines.map((line) =>
    line.productId === productId ? { ...line, ...patch } : line,
  );

export const useCartStore = create<CartState>()((set) => ({
  lines: [],
  orderDiscount: 0,

  addProduct: (product, quantity = 1) =>
    set((state) => {
      const existing = state.lines.find(
        (line) => line.productId === product.id,
      );
      return {
        lines: existing
          ? patchLine(state.lines, product.id, {
              quantity: round3(existing.quantity + quantity),
            })
          : [...state.lines, lineFromProduct(product, quantity)],
      };
    }),

  setQuantity: (productId, quantity) =>
    set((state) => ({
      lines: patchLine(state.lines, productId, { quantity }),
    })),

  setUnitPrice: (productId, unitPrice) =>
    set((state) => ({
      lines: patchLine(state.lines, productId, { unitPrice }),
    })),

  setLineDiscount: (productId, discount) =>
    set((state) => ({
      lines: patchLine(state.lines, productId, { discount }),
    })),

  removeLine: (productId) =>
    set((state) => ({
      lines: state.lines.filter((line) => line.productId !== productId),
    })),

  setOrderDiscount: (orderDiscount) => set({ orderDiscount }),

  clear: () => set({ lines: [], orderDiscount: 0 }),
}));

/**
 * `round2(unitPrice * quantity - discount)` — `sale.service.ts:155`, exactly.
 *
 * Rounded per line and **not** at the end. The server rounds here and again on
 * the sum, and the two orders of operation disagree: two lines of `0.25 × 0.5`
 * are `0.13 + 0.13 = 0.26` the server's way and `round2(0.25) = 0.25` if the
 * raw products are summed first. Pinned by `cart.test.ts`.
 */
export const lineTotal = (line: CartLine): number =>
  round2(line.unitPrice * line.quantity - line.discount);

/** The three figures the cart panel prints. All in the business's MAIN currency. */
export interface CartTotals {
  /** `round2(sum of lineTotal)` — `sale.service.ts:173`. */
  subtotal: number;
  /** Echoed back so a caller has all three from one call. */
  orderDiscount: number;
  /** `round2(subtotal - orderDiscount)` — `sale.service.ts:174`. */
  total: number;
}

export const cartTotals = ({
  lines,
  orderDiscount,
}: CartContents): CartTotals => {
  const subtotal = round2(
    lines.reduce((sum, line) => sum + lineTotal(line), 0),
  );
  return { subtotal, orderDiscount, total: round2(subtotal - orderDiscount) };
};

/**
 * The two states the server refuses that this cart can see coming.
 *
 * Both are 422s raised in the backend **service**, not its validator
 * (`sale.service.ts:156-158` and `:175`), from numbers that are not in the
 * request body — so `createSaleSchema.safeParse` cannot catch either, however
 * faithfully it mirrors the validator. Without this, an over-discounted line is
 * a round trip that comes back as a generic `VALIDATION_ERROR` and a message the
 * cashier has to decode.
 *
 * `canSubmit` is necessary, not sufficient: parse the payload with
 * `createSaleSchema` too, and the server still gets the last word on stock,
 * currency, the customer and the due date.
 */
export interface CartIssues {
  /** Nothing rung up. `items` is `min(1)`, so an empty cart is a 422 as well. */
  isEmpty: boolean;
  /**
   * Product ids whose discount exceeds their own line total. The server names
   * the first one it meets, keyed `errors.items`; this names all of them, so
   * every offending line can be flagged at once.
   */
  negativeLines: ObjectId[];
  /** The order discount exceeds the subtotal — the server keys this `errors.discount`. */
  orderDiscountExceedsSubtotal: boolean;
  /** False when posting this cart is certain to be refused. */
  canSubmit: boolean;
}

export const cartIssues = (contents: CartContents): CartIssues => {
  const negativeLines = contents.lines
    .filter((line) => lineTotal(line) < 0)
    .map((line) => line.productId);
  const orderDiscountExceedsSubtotal = cartTotals(contents).total < 0;
  const isEmpty = contents.lines.length === 0;

  return {
    isEmpty,
    negativeLines,
    orderDiscountExceedsSubtotal,
    canSubmit:
      !isEmpty && negativeLines.length === 0 && !orderDiscountExceedsSubtotal,
  };
};

/**
 * Everything a sale needs that the cart does not hold.
 *
 * The currency is here rather than in the store on purpose: it is the
 * business's `mainCurrency` or `exchangeCurrency` from `useCurrencyConfig()`,
 * which is server state, and a copy of it parked in a client store is the
 * "never hold the same fact twice" rule broken in the one place where being
 * wrong prints the wrong currency on a receipt.
 */
export interface SaleTender {
  /** ISO 4217 **code** from `useCurrencyConfig()`. Never a symbol, never a literal. */
  currency: string;
  /** In `currency` — not converted to main. The server does the conversion. */
  amountTendered: number;
  /** Required by the server once anything is left owing. */
  customerId?: ObjectId;
  /**
   * A **full ISO datetime**: `date.toISOString()`. A bare `YYYY-MM-DD` is a 422,
   * and so is an offset form like `…+03:00` — Zod's `datetime()` accepts only a
   * `Z` suffix, on both sides of the wire. (`from`/`to` on `GET /sales` are the
   * opposite: bare calendar dates.)
   */
  dueDate?: string;
  note?: string;
}

/**
 * Builds the exact `POST /sales` body.
 *
 * The body is `.strict()` on both the object and each item, so what is absent
 * matters as much as what is present. Three fields are omitted rather than sent
 * as zero or as a repeat of a value the server already knows:
 *
 *   - **`unitPrice`, when it still equals the product's selling price.** The
 *     service substitutes `product.sellingPrice` for an absent one
 *     (`sale.service.ts:153`), so sending it back is noise. The consequence to
 *     know: the substitution reads the product's price **at commit time**, so a
 *     price changed between ringing up and completing is honoured by the server
 *     and not by the cart's display. The window is seconds and the alternative
 *     is never omitting anything; see `docs/findings/slice3-sales-data.md`.
 *   - **`discount`, line-level and order-level, when zero.** Both are
 *     `.default(0)` on the server (`sale.validation.ts:17,29`), so an absent key
 *     and an explicit `0` store the same thing.
 *   - **`customerId` / `dueDate` / `note`, when unset.** A blank note is dropped
 *     rather than sent as `""`.
 *
 * Nothing here validates. Feed the result to `createSaleSchema.safeParse` and
 * check `cartIssues` first — this function's only job is the shape.
 */
export const buildSalePayload = (
  { lines, orderDiscount }: CartContents,
  tender: SaleTender,
): CreateSaleInput => {
  const note = tender.note?.trim();

  return {
    ...(tender.customerId && { customerId: tender.customerId }),
    items: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      ...(line.unitPrice !== line.listPrice && { unitPrice: line.unitPrice }),
      ...(line.discount !== 0 && { discount: line.discount }),
    })),
    ...(orderDiscount !== 0 && { discount: orderDiscount }),
    payment: {
      currency: tender.currency,
      amountTendered: tender.amountTendered,
    },
    ...(tender.dueDate && { dueDate: tender.dueDate }),
    ...(note && { note }),
  };
};

/**
 * The cart, its totals and its verdict, for a component.
 *
 * Two selectors returning stable values, composed into a fresh object **outside**
 * the store subscription. Selecting `(state) => ({ lines, orderDiscount })`
 * directly would build a new object on every `getSnapshot`, which zustand v5
 * reports as an infinite render loop rather than a wrong value — this shape is
 * how the store stays usable without `useShallow` at every call site.
 *
 * Actions are read separately (`useCartStore((s) => s.addProduct)`); a function
 * on the store is referentially stable for the store's lifetime.
 */
export function useCart(): CartContents & {
  totals: CartTotals;
  issues: CartIssues;
} {
  const lines = useCartStore((state) => state.lines);
  const orderDiscount = useCartStore((state) => state.orderDiscount);
  const contents = { lines, orderDiscount };

  return {
    ...contents,
    totals: cartTotals(contents),
    issues: cartIssues(contents),
  };
}
