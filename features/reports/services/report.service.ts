import type {
  DeadStockDays,
  DeadStockReport,
  DebtsAgeingReport,
  DebtsSummaryReport,
  PaymentMixReport,
  PeriodParams,
  ReportsDashboard,
  SalesSummaryReport,
  SalesTrendReport,
  StaffSalesReport,
  StockReport,
  TopCustomersBy,
  TopCustomersReport,
  TopProductsBy,
  TopProductsReport,
  TrendGranularity,
} from "@/features/reports/types";
import { apiGet } from "@/lib/api/client";

/**
 * The only file in this slice that knows a URL exists.
 *
 * No React, no hooks, no toasts, and no envelope handling — the response
 * interceptor in `lib/api/client` has already unwrapped
 * `{ success, message, data }` and turned every failure into an `ApiError`.
 *
 * Eleven functions for the twelve routes in `docs/contracts/reports.md` §0.
 * The twelfth, bare `GET /reports`, is a **byte-for-byte alias of
 * `GET /reports/dashboard`** (§3.12 — it exists only so a router-root request
 * 401s instead of 404ing), so calling it would be a second name for one
 * request and a second cache entry for one answer.
 *
 * Every query object on this feature is `.strict()`: an unknown key is a 422,
 * never a silently ignored filter. `undefined` values are omitted from the
 * query string by axios, which is what lets the period params be spread in
 * unconditionally.
 */
const BASE = "/reports";

/**
 * `GET /reports/dashboard` — the hub's ten figures and a daily trend.
 *
 * **Not `GET /dashboard`.** Different permission (`reports:view` vs
 * `organization:view`), different parameters (a period vs none at all),
 * different shape — and the identical success message, which is the trap. The
 * Overview uses the other one; the two must never be crossed
 * (`docs/contracts/reports.md` §5).
 */
export const getReportsDashboard = (
  params: PeriodParams,
): Promise<ReportsDashboard> =>
  apiGet<ReportsDashboard>(`${BASE}/dashboard`, { params });

export const getSalesSummary = (
  params: PeriodParams,
): Promise<SalesSummaryReport> =>
  apiGet<SalesSummaryReport>(`${BASE}/sales/summary`, { params });

export const getSalesTrend = (
  params: PeriodParams,
  granularity: TrendGranularity,
): Promise<SalesTrendReport> =>
  apiGet<SalesTrendReport>(`${BASE}/sales/trend`, {
    params: { ...params, granularity },
  });

export const getPaymentMix = (
  params: PeriodParams,
): Promise<PaymentMixReport> =>
  apiGet<PaymentMixReport>(`${BASE}/sales/payment-mix`, { params });

/** `limit` is capped at **50** here, not the list convention's 100. */
export const getTopProducts = (
  params: PeriodParams,
  by: TopProductsBy,
  limit: number,
): Promise<TopProductsReport> =>
  apiGet<TopProductsReport>(`${BASE}/products/top`, {
    params: { ...params, by, limit },
  });

/**
 * `GET /reports/products/stock` — point in time.
 *
 * **No params object at all.** `stockQuerySchema` is literally
 * `z.object({}).strict()`, so `?period=month` is a 422 rather than an ignored
 * key (contract §1.2). This is why the signature takes nothing.
 */
export const getStockReport = (): Promise<StockReport> =>
  apiGet<StockReport>(`${BASE}/products/stock`);

/** `days` must be exactly 30, 60 or 90 — it is a refine on three literals, not a range. */
export const getDeadStock = (days: DeadStockDays): Promise<DeadStockReport> =>
  apiGet<DeadStockReport>(`${BASE}/products/dead`, { params: { days } });

export const getStaffSales = (
  params: PeriodParams,
): Promise<StaffSalesReport> =>
  apiGet<StaffSalesReport>(`${BASE}/staff/sales`, { params });

export const getDebtsSummary = (
  params: PeriodParams,
): Promise<DebtsSummaryReport> =>
  apiGet<DebtsSummaryReport>(`${BASE}/debts/summary`, { params });

/** Point in time, and the same 422-on-any-key schema as `products/stock`. */
export const getDebtsAgeing = (): Promise<DebtsAgeingReport> =>
  apiGet<DebtsAgeingReport>(`${BASE}/debts/ageing`);

/**
 * `by=balance` **accepts and echoes the period while ignoring it entirely** —
 * it sums open debts as of now (contract §3.10). The screen says so beside the
 * toggle rather than leaving the picker looking broken.
 */
export const getTopCustomers = (
  params: PeriodParams,
  by: TopCustomersBy,
  limit: number,
): Promise<TopCustomersReport> =>
  apiGet<TopCustomersReport>(`${BASE}/customers/top`, {
    params: { ...params, by, limit },
  });
