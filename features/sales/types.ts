import type { ObjectId, PaginationParams } from "@/lib/api/types";

/**
 * Re-states a type's own properties as an object literal type.
 *
 * `SaleListParams` is a React Query key input, and `createQueryKeys(...).list()`
 * takes `QueryKeyParams = Record<string, unknown>` — which an `interface` is
 * **not** assignable to (TypeScript withholds the implicit index signature from
 * interfaces, because a later declaration can reopen one). Copied from
 * `features/products/types.ts`, which hit the same wall.
 */
type Flat<T> = { [K in keyof T]: T[K] };

/**
 * The wire shapes of the four `/sales` rows in `docs/API-ROUTES.md`.
 *
 * Transcribed field for field from `publicSale`
 * (`../Backend/src/controller/sale.controller.ts:10-47`), the shaper all four
 * endpoints map through — the list rows, the detail row, the 201 from a create
 * and the 200 from a void are the same object. `organizationId`, `__v` and
 * `items[].trackStock` exist on the stored document and are dropped by the
 * shaper, so they are absent here.
 *
 * **Nothing nested is populated.** `customerId`, every `items[].productId`,
 * `debtId`, `voidedBy` and `soldBy` are bare id strings produced by
 * `.toString()`, never `{ id, name }` sub-objects, and there is no `?populate=`
 * on this route. A screen that needs a customer's name issues its own
 * `GET /customers/:id`; a screen that needs a line's product name reads the
 * **snapshot** below instead (`docs/contracts/sales.md` §5).
 *
 * Dates are ISO 8601 **strings**. Feed them to `formatDate(iso, timezone)` with
 * the business timezone from `useOrganization()`.
 */

/**
 * One line of a sale, frozen at the moment it was rung up.
 *
 * `name`, `barcode` and `unit` are snapshots, not joins: renaming a product
 * afterwards does not rewrite past receipts. So are `unitPrice` and `costPrice`
 * — which is why a receipt must never be re-priced from `GET /products/:id`.
 */
export interface SaleItem {
  productId: ObjectId;
  /** Snapshot of `product.name` at sale time, not the product's current name. */
  name: string;
  barcode?: string;
  /** Snapshot of `product.unit`. `formatQuantity(quantity, unit)`. */
  unit: string;
  /** Up to 3 dp — goods sold by weight. */
  quantity: number;
  /** Main currency, 2 dp. The override the cashier typed, or the product's selling price. */
  unitPrice: number;
  /**
   * Snapshot of `product.costPrice`. It rides on every sale because margin
   * reports are computed from the sale, not from the product's price today.
   */
  costPrice: number;
  /** An **amount**, not a percentage. 2 dp, `0` when none was given. */
  discount: number;
  /** `round2(unitPrice * quantity - discount)` (`sale.service.ts:155`). Never negative. */
  lineTotal: number;
}

/**
 * How the customer paid.
 *
 * **Two of these six fields are in the tendered currency and two are in the
 * business's main currency**, and mixing them up on a receipt is the failure
 * this comment exists to prevent (`docs/contracts/sales.md` §6, trap 5):
 *
 * - in `currency`: `amountTendered`, `change`
 * - in the **main** currency: `amountPaidMain`, `amountDue` — and so are the
 *   sale's `subtotal`, `discount` and `total`
 *
 * There is no `amountTenderedMain`. To compare a tender with a total, convert
 * with `exchangeRate`, which **multiplies** (`toMain`,
 * `../Backend/src/lib/money.ts:28`) — `formatExchange` already does it.
 */
export interface SalePayment {
  /** ISO 4217 code the customer actually paid in: the org's main OR exchange currency. */
  currency: string;
  /**
   * Units of main per one unit of exchange, **frozen on this sale at creation**
   * — `1` when `currency` is the main currency. Later edits to the business's
   * `CurrencyConfig` never re-price a past sale (`create.test.ts:188-203`,
   * `credit.test.ts:330-361`).
   */
  exchangeRate: number;
  /** What was handed over, in `currency`. */
  amountTendered: number;
  /** `min(toMain(amountTendered, rate), total)`, in MAIN currency. */
  amountPaidMain: number;
  /** Change given back, in `currency` — **not** in main. */
  change: number;
  /** `total - amountPaidMain`, in MAIN currency. Above zero means a debt exists. */
  amountDue: number;
}

/** `amountDue === 0` → paid; `amountDue === total` → credit; anything between → partial. */
export type SalePaymentStatus = "paid" | "partial" | "credit";

/**
 * A sale is immutable and has exactly one state transition, `completed ->
 * voided`, one-way and at most once. There is no `PATCH /sales/:id` and no
 * delete (`docs/contracts/sales.md` §8).
 */
export type SaleStatus = "completed" | "voided";

export interface Sale {
  id: ObjectId;
  /** `S-000123` — per-organization, zero-padded to 6. Render mono. */
  number: string;
  /** Absent on a walk-in sale. A bare id: fetch the customer separately for a name. */
  customerId?: ObjectId;
  items: SaleItem[];
  /** Sum of `items[].lineTotal`, main currency, 2 dp. */
  subtotal: number;
  /** The **order-level** discount, an amount. Distinct from `items[].discount`. */
  discount: number;
  /** `round2(subtotal - discount)`. What the customer owes before anything is tendered. */
  total: number;
  payment: SalePayment;
  paymentStatus: SalePaymentStatus;
  /** The `Debt` this sale opened. Present only when `payment.amountDue > 0`. */
  debtId?: ObjectId;
  /** ISO datetime. Present only on a partial/credit sale — it is the debt's due date. */
  dueDate?: string;
  note?: string;
  status: SaleStatus;
  voidedAt?: string;
  /**
   * A **Member** id, not a user id (`Backend/CLAUDE.md`, confirmed on the wire
   * by `create.test.ts:342-355`). Comparing it with the signed-in user's id
   * from `/auth/me` never matches; compare it with the caller's `member.id`.
   */
  voidedBy?: ObjectId;
  voidReason?: string;
  /** A Member id, always present. See the note on `voidedBy`. */
  soldBy: ObjectId;
  createdAt: string;
  updatedAt: string;
}

/**
 * `?status=` on the list. `"all"` is the filter's "do not filter" option and is
 * the server's **default** — unlike products and customers, whose lists default
 * to `active` and therefore hide rows until asked. A sales list sent with no
 * `status` shows voided sales too (`sale.validation.ts:43`).
 */
export type SaleStatusFilter = "completed" | "voided" | "all";

/** The date-range presets `GET /sales` accepts, resolved in the business timezone. */
export type SalePeriod = "today" | "week" | "month" | "year";

/**
 * Everything `GET /sales` accepts, and nothing else — the query schema is
 * `.strict()`, so an unknown key is a 422 rather than an ignored filter.
 *
 * Flat and scalar-only on purpose: this is what `nuqs` keeps in the URL and
 * what React Query hashes into the key.
 *
 * **There is no `search` here.** Products and customers have one; sales do not
 * (`sale.validation.ts:38-49`), so the brief's "search by receipt number" on
 * the sales list cannot be served by this endpoint — see
 * `docs/findings/slice3-sales-data.md`.
 *
 * `period` and `from`/`to` are mutually exclusive, and `from`/`to` must be sent
 * together (`common.validation.ts:82-87`). They are three optional fields
 * rather than a discriminated union so a URL can hold a half-typed range; the
 * service drops an incomplete one rather than posting a guaranteed 422.
 */
export type SaleListParams = Flat<
  PaginationParams & {
    status?: SaleStatusFilter;
    paymentStatus?: SalePaymentStatus;
    customerId?: ObjectId;
    /** A **Member** id, not a user id — the same value as `Sale.soldBy`. */
    soldBy?: ObjectId;
    period?: SalePeriod;
    /**
     * A bare calendar date, `YYYY-MM-DD` — **not** an ISO datetime, which is
     * what `dueDate` on `POST /sales` needs. The two look interchangeable and
     * are not (`docs/contracts/sales.md` trap 2).
     */
    from?: string;
    /**
     * `YYYY-MM-DD`, and **inclusive** of that whole day: `resolvePeriod` adds a
     * day before the `$lt` (`../Backend/src/lib/period.ts:91`), so
     * `to=2026-09-03` does return sales made on the 3rd. The contract's §1 table
     * calls `to` "exclusive", which is true of the resolved *instant* and false
     * of the *date a caller sends* — see `docs/findings/slice3-sales-data.md`.
     */
    to?: string;
  }
>;
