import type {
  DeadStockDays,
  PeriodParams,
  TopCustomersBy,
  TopProductsBy,
  TrendGranularity,
} from "@/features/reports/types";

/**
 * Report query keys.
 *
 * Not built on `createQueryKeys` — same reason as `features/dashboard/keys.ts`.
 * Nothing here is a list or a detail: these are twelve named read-only
 * aggregates, most parameterised by a period rather than by an id, and the
 * generic shape would only add an empty `list({})` segment to hash.
 *
 * Every key that takes a period takes the **resolved** `PeriodParams` — the
 * object that actually goes on the wire, after `period: "custom"` has become
 * `from`/`to` and an unusable range has been dropped. Two spellings of one
 * request would otherwise be two cache entries and a refetch on every toggle.
 *
 * `all` is a prefix of every one of them, so a write anywhere in the product
 * (a sale, a void, a repayment) can discard the whole feature with one
 * `invalidateQueries({ queryKey: reportKeys.all })`. **Report figures are not
 * immutable**: voiding an old sale rewrites that old period's revenue for ever
 * (`docs/contracts/reports.md` §3.1), so nothing here may be cached as if it
 * were history.
 */
const scope = "reports" as const;

export const reportKeys = {
  /** The prefix. Invalidate after any write that moves a figure. */
  all: [scope] as const,

  /** `GET /reports/dashboard` — the hub. */
  dashboard: (params: PeriodParams) =>
    [scope, "dashboard", { ...params }] as const,

  salesSummary: (params: PeriodParams) =>
    [scope, "sales", "summary", { ...params }] as const,
  salesTrend: (params: PeriodParams, granularity: TrendGranularity) =>
    [scope, "sales", "trend", { ...params, granularity }] as const,
  paymentMix: (params: PeriodParams) =>
    [scope, "sales", "payment-mix", { ...params }] as const,

  topProducts: (params: PeriodParams, by: TopProductsBy, limit: number) =>
    [scope, "products", "top", { ...params, by, limit }] as const,
  /**
   * No period in the key, because the endpoint takes no query parameters at
   * all — sending one is a 422. The screen's period picker genuinely does not
   * move this figure, and a key that pretended otherwise would refetch an
   * identical request on every toggle.
   */
  stock: () => [scope, "products", "stock"] as const,
  /** `days` only, for the same reason. */
  deadStock: (days: DeadStockDays) =>
    [scope, "products", "dead", { days }] as const,

  staffSales: (params: PeriodParams) =>
    [scope, "staff", "sales", { ...params }] as const,

  debtsSummary: (params: PeriodParams) =>
    [scope, "debts", "summary", { ...params }] as const,
  /** Point-in-time, no parameters. */
  debtsAgeing: () => [scope, "debts", "ageing"] as const,

  topCustomers: (params: PeriodParams, by: TopCustomersBy, limit: number) =>
    [scope, "customers", "top", { ...params, by, limit }] as const,
} as const;
