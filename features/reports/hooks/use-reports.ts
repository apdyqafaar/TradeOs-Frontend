"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { reportKeys } from "@/features/reports/keys";
import {
  getDeadStock,
  getDebtsAgeing,
  getDebtsSummary,
  getPaymentMix,
  getReportsDashboard,
  getSalesSummary,
  getSalesTrend,
  getStaffSales,
  getStockReport,
  getTopCustomers,
  getTopProducts,
} from "@/features/reports/services/report.service";
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
import type { ApiError } from "@/lib/api/errors";

/**
 * One hook per report.
 *
 * `staleTime` is a minute everywhere, matching the Overview: a report is a
 * considered read of the business, not a live board, and every one of these
 * runs one or more full aggregations server-side — the sales screen alone is
 * three of them. A shorter window would re-run all three every time someone
 * tabbed away and back.
 *
 * It is deliberately **not** `Infinity`. Report figures are not history:
 * voiding a sale from three weeks ago removes it from that period's revenue
 * for ever, so two identical requests can legitimately disagree
 * (`docs/contracts/reports.md` §3.1).
 *
 * Every one of them can fail with a **400** — `INVALID_PERIOD`,
 * `PERIOD_TOO_LONG`, `INVALID_DATE` — which is not the 422 a bad query
 * normally produces, because `resolvePeriod` runs after validation has passed.
 * `isPeriodError` in `lib/period.ts` is the predicate; the screens use it to
 * put the message on the period bar instead of over the whole page.
 */
const STALE_TIME = 60_000;

/** `GET /reports/dashboard` — the hub. Never `GET /dashboard`, which is the Overview's. */
export function useReportsDashboard(
  params: PeriodParams,
): UseQueryResult<ReportsDashboard, ApiError> {
  return useQuery<ReportsDashboard, ApiError>({
    queryKey: reportKeys.dashboard(params),
    queryFn: () => getReportsDashboard(params),
    staleTime: STALE_TIME,
  });
}

export function useSalesSummary(
  params: PeriodParams,
): UseQueryResult<SalesSummaryReport, ApiError> {
  return useQuery<SalesSummaryReport, ApiError>({
    queryKey: reportKeys.salesSummary(params),
    queryFn: () => getSalesSummary(params),
    staleTime: STALE_TIME,
  });
}

export function useSalesTrend(
  params: PeriodParams,
  granularity: TrendGranularity,
): UseQueryResult<SalesTrendReport, ApiError> {
  return useQuery<SalesTrendReport, ApiError>({
    queryKey: reportKeys.salesTrend(params, granularity),
    queryFn: () => getSalesTrend(params, granularity),
    staleTime: STALE_TIME,
  });
}

export function usePaymentMix(
  params: PeriodParams,
): UseQueryResult<PaymentMixReport, ApiError> {
  return useQuery<PaymentMixReport, ApiError>({
    queryKey: reportKeys.paymentMix(params),
    queryFn: () => getPaymentMix(params),
    staleTime: STALE_TIME,
  });
}

export function useTopProducts(
  params: PeriodParams,
  by: TopProductsBy,
  limit: number,
): UseQueryResult<TopProductsReport, ApiError> {
  return useQuery<TopProductsReport, ApiError>({
    queryKey: reportKeys.topProducts(params, by, limit),
    queryFn: () => getTopProducts(params, by, limit),
    staleTime: STALE_TIME,
  });
}

/** Point-in-time, and takes no parameters — the period picker does not move it. */
export function useStockReport(): UseQueryResult<StockReport, ApiError> {
  return useQuery<StockReport, ApiError>({
    queryKey: reportKeys.stock(),
    queryFn: getStockReport,
    staleTime: STALE_TIME,
  });
}

export function useDeadStock(
  days: DeadStockDays,
): UseQueryResult<DeadStockReport, ApiError> {
  return useQuery<DeadStockReport, ApiError>({
    queryKey: reportKeys.deadStock(days),
    queryFn: () => getDeadStock(days),
    staleTime: STALE_TIME,
  });
}

export function useStaffSales(
  params: PeriodParams,
): UseQueryResult<StaffSalesReport, ApiError> {
  return useQuery<StaffSalesReport, ApiError>({
    queryKey: reportKeys.staffSales(params),
    queryFn: () => getStaffSales(params),
    staleTime: STALE_TIME,
  });
}

export function useDebtsSummary(
  params: PeriodParams,
): UseQueryResult<DebtsSummaryReport, ApiError> {
  return useQuery<DebtsSummaryReport, ApiError>({
    queryKey: reportKeys.debtsSummary(params),
    queryFn: () => getDebtsSummary(params),
    staleTime: STALE_TIME,
  });
}

/** Point-in-time, no parameters. Always five zero-filled buckets, in ladder order. */
export function useDebtsAgeing(): UseQueryResult<DebtsAgeingReport, ApiError> {
  return useQuery<DebtsAgeingReport, ApiError>({
    queryKey: reportKeys.debtsAgeing(),
    queryFn: getDebtsAgeing,
    staleTime: STALE_TIME,
  });
}

export function useTopCustomers(
  params: PeriodParams,
  by: TopCustomersBy,
  limit: number,
): UseQueryResult<TopCustomersReport, ApiError> {
  return useQuery<TopCustomersReport, ApiError>({
    queryKey: reportKeys.topCustomers(params, by, limit),
    queryFn: () => getTopCustomers(params, by, limit),
    staleTime: STALE_TIME,
  });
}
