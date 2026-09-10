/**
 * The wire shapes of the twelve `GET /reports*` endpoints.
 *
 * Every field below is transcribed from a service in
 * `../Backend/src/services/reports/`, with the `file:line` for each claim in
 * `docs/contracts/reports.md` §3. Change one of these only against that
 * contract or the backend source — a wrong field name here does not fail
 * loudly, it renders as a blank cell.
 *
 * Three things are true of the whole feature and easy to get wrong:
 *
 *  1. **No payload carries a currency.** Every `revenue`, `cogs`, `value`,
 *     `stockValue`, `outstanding` and `collected` below is a bare number in the
 *     organization's **main** currency (contract §6). The code comes from
 *     `useOrganization()`, never from a report.
 *  2. **`share` and `marginPct` are fractions (0..1), not percentages** —
 *     `round4`, so multiply by 100 to render (§2.1, §3.1).
 *  3. **There is no `meta` and no pagination** on any of the twelve (§1.3).
 */

/** The four presets `resolvePeriod` accepts. `month` is the server's default. */
export type PeriodPreset = "today" | "week" | "month" | "year";

/**
 * The period echo nine of the twelve append to their payload.
 *
 * **`to` is the EXCLUSIVE bound as an ISO instant**, not the inclusive
 * `YYYY-MM-DD` that was sent (`services/reports/period.ts:23-27`). Feeding it
 * back into a `to=` query is wrong twice — wrong format (a 400 `INVALID_DATE`)
 * and, truncated to a date, a day too far. It is displayed, never re-sent.
 */
export interface PeriodEcho {
  from: string;
  to: string;
  /** The organization's IANA zone, re-read per request. Never the browser's. */
  timezone: string;
}

/**
 * The row shape six endpoints share (`services/reports/shapes.ts:14-20`).
 *
 * Sorted by `value` descending, and `share` is `value / sum of the RETURNED
 * rows` — computed after `$limit`, so on a top-10 it is "share of the ten
 * shown", not of the period's total (§2.1). Say which, or say neither.
 */
export interface BreakdownItem {
  key: string;
  label: string;
  value: number;
  /** 0..1. `0` when the rows sum to zero — never a division by zero. */
  share: number;
}

/** `GET /reports/sales/summary` (§3.1). */
export interface SalesSummaryReport {
  /** Accrual: a credit sale counts in full on the day it was rung up. */
  revenue: number;
  salesCount: number;
  /** `revenue / salesCount`, already rounded; `0` when the count is 0. */
  averageSale: number;
  cogs: number;
  /** Can be negative. Nothing clamps it. */
  grossProfit: number;
  /** A **fraction** despite the name: 0.3769 is 37.69%. */
  marginPct: number;
  discountTotal: number;
  /** Cash taken at the till, so `revenue - creditIssued` is not this number. */
  collectedAtSale: number;
  creditIssued: number;
  /**
   * Matched on the voided sale's `createdAt`, not its `voidedAt`
   * (`shapes.ts:41-45`) — a sale rung up in September and voided in October
   * counts in September's void figures and in none of October's.
   */
  voidedCount: number;
  voidedAmount: number;
  period: PeriodEcho;
}

export type TrendGranularity = "day" | "week" | "month";

/**
 * One bucket of `GET /reports/sales/trend`.
 *
 * `bucket` is a **label already resolved in the business timezone** —
 * `yyyy-MM-dd` for day and week (the Monday), `yyyy-MM` for month — not an
 * instant. Parsing it as a date re-reads it as UTC midnight and can name the
 * previous day west of Greenwich.
 */
export interface TrendBucket {
  bucket: string;
  revenue: number;
  cogs: number;
  /** `revenue - cogs`; negative on a loss-making bucket. */
  profit: number;
  /** Sales, not line items. */
  count: number;
}

/** `GET /reports/sales/trend` (§3.2). Always zero-filled, always ascending. */
export interface SalesTrendReport {
  granularity: TrendGranularity;
  series: TrendBucket[];
  period: PeriodEcho;
}

/** A payment-mix row. `count` is sales, including one that tendered nothing. */
export interface PaymentMixItem extends BreakdownItem {
  count: number;
}

/** `GET /reports/sales/payment-mix` (§3.3). */
export interface PaymentMixReport {
  /** `key` is `paid | partial | credit`; `value` sums accrual revenue. */
  byPaymentStatus: PaymentMixItem[];
  /**
   * `key` is the ISO code **tendered at the counter**, `value` is still in the
   * **main** currency (`amountPaidMain`). A row `{ key: "KES", value: 500 }`
   * means "500 of main currency was tendered in KES", not 500 KES. Neither
   * array is zero-filled, and the two deliberately do not sum to the same
   * total: status is accrual, currency is cash collected.
   */
  byCurrency: PaymentMixItem[];
  period: PeriodEcho;
}

export type TopProductsBy = "revenue" | "quantity";

/** One row of `GET /reports/products/top`. */
export interface TopProductItem extends BreakdownItem {
  /**
   * `label` is the name **frozen at the moment of sale** (`items.name`), never
   * the product's current name — the pipeline deliberately never looks the
   * product up. A renamed product legitimately shows its old name in a
   * historical report. That is correct, not a bug.
   */
  label: string;
  /** Raw, up to 3 dp for weighed goods — `value` is its rounded twin. */
  quantity: number;
  revenue: number;
  profit: number;
}

/** `GET /reports/products/top` (§3.4). */
export interface TopProductsReport {
  items: TopProductItem[];
  period: PeriodEcho;
}

/** A `lowStock` / `outOfStock` row. Carries its own `name`, so no second fetch. */
export interface StockRow {
  /** **`productId`, not `id`** — a deliberate deviation from the wire rule. */
  productId: string;
  name: string;
  quantity: number;
  /**
   * Absent from the JSON entirely when the product has no `lowStockThreshold`
   * (`$project` emits no key for a missing field), which can only happen on an
   * `outOfStock` row.
   */
  threshold?: number;
}

/**
 * `GET /reports/products/stock` (§3.5). **Point-in-time: no query params at
 * all** — any query key is a 422 — and therefore no `period` echo.
 */
export interface StockReport {
  trackedCount: number;
  stockValue: number;
  retailValue: number;
  /** Both lists are the 50 lowest quantities ascending. */
  lowStock: StockRow[];
  /**
   * A product can be in **both** lists (quantity 0 with a threshold set), so
   * `lowStock.length + outOfStock.length` is not a count of anything.
   */
  outOfStock: StockRow[];
}

/** `days` on `GET /reports/products/dead` — exactly these three, or a 422. */
export type DeadStockDays = 30 | 60 | 90;

/** One row of `GET /reports/products/dead`. */
export interface DeadProductItem extends BreakdownItem {
  /** The **live** `Product.name` here — unlike `products/top`'s snapshot. */
  label: string;
  quantity: number;
  /** `value` is this number; both are `quantity * costPrice`. */
  stockValue: number;
  /** All-time last completed sale, ignoring `days`. `null` = never sold. */
  lastSoldAt: string | null;
}

/**
 * `GET /reports/products/dead` (§3.6). **No period, `?days=` only**, and the
 * cutoff is a rolling wall-clock instant rather than a calendar boundary — the
 * one place in this feature that is not timezone-aware.
 */
export interface DeadStockReport {
  items: DeadProductItem[];
}

/** One row of `GET /reports/staff/sales`. */
export interface StaffSalesItem extends BreakdownItem {
  /** A **Member** id, not a User id. `/auth/me`'s user id will not match it. */
  key: string;
  /** `User.name`, or the literal `"Removed member"` when the user row is gone. */
  label: string;
  salesCount: number;
  revenue: number;
  profit: number;
  voidsCount: number;
  /**
   * **Debt repayments only.** `Payment` never records money taken at the till,
   * so a member with `salesCount: 0` and a non-zero `collected` is a real and
   * common row, not a bug.
   */
  collected: number;
}

/** `GET /reports/staff/sales` (§3.7). Not limited, so `share` is a true share. */
export interface StaffSalesReport {
  items: StaffSalesItem[];
  period: PeriodEcho;
}

/**
 * `GET /reports/debts/summary` (§3.8).
 *
 * **Half of this payload ignores the period it echoes.** The first four
 * numbers describe *right now*; only the last four move with the picker, and
 * each of those keys off a different date field. A screen that files all eight
 * under one month heading is lying about four of them.
 */
export interface DebtsSummaryReport {
  /** Point-in-time. */
  outstanding: number;
  /** Point-in-time. */
  openCount: number;
  /** Point-in-time, `dueDate < now` server-side. */
  overdueAmount: number;
  /** Point-in-time. */
  overdueCount: number;
  /** Period, by `Debt.createdAt` — counts debts later cancelled or written off. */
  newDebt: number;
  /** Period, by `Payment.createdAt`. Debt repayments only. */
  collected: number;
  /** Period, by `Debt.writtenOffAt`. */
  writtenOff: number;
  /** Period, by `Debt.cancelledAt`. Sums `principal`, not a written-off amount. */
  cancelledAmount: number;
  period: PeriodEcho;
}

/** The five fixed ageing buckets, in the order the API returns them. */
export type AgeingKey = "current" | "1-30" | "31-60" | "61-90" | "90+";

export interface AgeingItem extends BreakdownItem {
  key: AgeingKey;
  count: number;
}

/**
 * `GET /reports/debts/ageing` (§3.9). **Point-in-time, no query params.**
 *
 * The one breakdown in the feature that is **not** sorted by value: it always
 * returns all five keys in ladder order, zero-filled, which is what `ordered`
 * announces. Render in array order; never re-sort.
 */
export interface DebtsAgeingReport {
  items: AgeingItem[];
  ordered: true;
}

export type TopCustomersBy = "spend" | "balance";

/**
 * One row of `GET /reports/customers/top`.
 *
 * `label` is **optional on the wire**: the `$lookup` has no `$ifNull` fallback,
 * so a miss emits no `label` key at all (§3.10). No hard-delete path for a
 * customer exists, so it should never fire — the cost of surviving it is one
 * `??` and the failure mode without one is a blank row.
 */
export interface TopCustomerItem {
  key: string;
  label?: string;
  value: number;
  share: number;
}

/** `GET /reports/customers/top` (§3.10). */
export interface TopCustomersReport {
  items: TopCustomerItem[];
  period: PeriodEcho;
}

/** `GET /reports/dashboard`'s trend bucket — 3.2's minus `cogs`, always daily. */
export interface ReportsDashboardTrendBucket {
  bucket: string;
  revenue: number;
  profit: number;
  count: number;
}

/**
 * `GET /reports/dashboard` (§3.11) — **not** `GET /dashboard`, which is the
 * Overview's endpoint on a different permission with a different shape and,
 * confusingly, the identical success message.
 *
 * Four of its ten numbers (`outstanding`, `overdueAmount`, `overdueCount`,
 * `lowStockCount`) ignore the period they sit beside.
 */
export interface ReportsDashboard {
  revenue: number;
  grossProfit: number;
  salesCount: number;
  /** Till cash **plus** debt repayments — not `debts/summary.collected`. */
  collected: number;
  /** Point-in-time. */
  outstanding: number;
  /** Point-in-time. */
  overdueAmount: number;
  /** Point-in-time. */
  overdueCount: number;
  /** Point-in-time, and uncapped — `products/stock.lowStock` stops at 50. */
  lowStockCount: number;
  trend: ReportsDashboardTrendBucket[];
  period: PeriodEcho;
}

/**
 * The period half of a report request, as it goes on the wire.
 *
 * `period` and `from`/`to` are **mutually exclusive** and `from`/`to` must be
 * given together — both refinements are 422s, not ignored keys — so this is
 * either one key or two, never a mix. `undefined` values are omitted from the
 * query string by axios, and are also what keeps two identical requests on one
 * React Query key.
 */
export interface PeriodParams {
  period?: PeriodPreset;
  /** Inclusive calendar date, `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive calendar date, `YYYY-MM-DD`. The last day you want to see. */
  to?: string;
}
