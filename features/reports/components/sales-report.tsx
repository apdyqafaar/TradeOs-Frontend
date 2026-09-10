"use client";

import { parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  type BarChartTone,
} from "@/features/dashboard/components/bar-chart";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { BreakdownRows } from "@/features/reports/components/breakdown-rows";
import { Figure, FigureGrid } from "@/features/reports/components/figure-grid";
import { ReportShell } from "@/features/reports/components/report-shell";
import { Segmented } from "@/features/reports/components/segmented";
import {
  usePaymentMix,
  useSalesSummary,
  useSalesTrend,
} from "@/features/reports/hooks/use-reports";
import {
  axisTicks,
  bucketLabel,
  moneyIn,
  percentOf,
} from "@/features/reports/lib/format";
import { toPeriodParams, useReportPeriod } from "@/features/reports/lib/period";
import type {
  PaymentMixItem,
  TrendGranularity,
} from "@/features/reports/types";
import { isPeriodError } from "@/lib/period";

const GRANULARITIES = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

const METRICS = [
  { value: "revenue", label: "Revenue", tone: "primary" },
  { value: "profit", label: "Profit", tone: "success" },
  { value: "count", label: "Count", tone: "info" },
] as const;

type MetricKey = (typeof METRICS)[number]["value"];

/**
 * `granularity` lives in the URL because it is part of the **request** — a
 * different bucket size is a different response, not a re-slice of what is
 * already on screen — and a report someone shares should open on the shape
 * they were looking at. Which of the three series is *drawn* stays local
 * state: that one changes nothing about what was fetched.
 */
const TREND_PARSERS = {
  granularity: parseAsStringLiteral(
    GRANULARITIES.map((entry) => entry.value),
  ).withDefault("day"),
};

/** The three payment statuses, in the order a till reads them. */
const PAYMENT_STATUSES = ["paid", "partial", "credit"] as const;

const PAYMENT_STATUS_LABELS: Record<(typeof PAYMENT_STATUSES)[number], string> =
  {
    paid: "Paid in full",
    partial: "Part paid",
    credit: "On credit",
  };

/**
 * The sales report — `/reports/sales`, artboard `2i`.
 *
 * Three requests, all on the same period: `sales/summary`, `sales/trend` and
 * `sales/payment-mix`. They are separate queries rather than one because the
 * trend has its own `granularity` parameter, and folding them together would
 * re-run two aggregations every time someone switched from Day to Week.
 */
export function SalesReport() {
  const [period, setPeriod] = useReportPeriod();
  const params = toPeriodParams(period);
  const [trend, setTrend] = useQueryStates(TREND_PARSERS, {
    history: "replace",
    scroll: false,
  });
  const [metric, setMetric] = useState<MetricKey>("revenue");

  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();
  const money = moneyIn(currency);

  const summary = useSalesSummary(params);
  const trendQuery = useSalesTrend(params, trend.granularity);
  const mix = usePaymentMix(params);

  if (
    summary.error?.status === 403 ||
    trendQuery.error?.status === 403 ||
    mix.error?.status === 403
  ) {
    return <ForbiddenScreen />;
  }

  // All three carry the same period, so one refusal is all three refusing.
  const refused = summary.error !== null && isPeriodError(summary.error);
  const activeMetric =
    METRICS.find((entry) => entry.value === metric) ?? METRICS[0];
  const series = (trendQuery.data?.series ?? []).map(
    (bucket) => bucket[metric],
  );

  return (
    <ReportShell
      title="Sales report"
      period={period}
      setPeriod={setPeriod}
      echo={summary.data?.period}
      refused={refused}
      timezone={timezone}
      currency={currency}
      organizationLoading={organizationLoading}
    >
      {summary.error && !refused ? <ErrorCard error={summary.error} /> : null}

      {summary.isPending || organizationLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {["a", "b", "c", "d"].map((key) => (
            <Skeleton key={key} className="h-[118px] rounded-[10px]" />
          ))}
        </div>
      ) : null}

      {summary.data && !organizationLoading ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Revenue"
              value={money(summary.data.revenue)}
              foot="accrual — a credit sale counts in full on the day it was rung up"
            />
            <StatCard
              label="Gross profit"
              value={money(summary.data.grossProfit)}
              // `marginPct` is the API's own figure and a **fraction** despite
              // the name — 0.3769 is 37.69%. Rendered through `percentOf`
              // rather than recomputed, so the card and the endpoint cannot
              // drift apart on rounding.
              delta={percentOf(summary.data.marginPct)}
              deltaTone={summary.data.grossProfit < 0 ? "negative" : "positive"}
              foot="margin"
            />
            <StatCard
              label="Sales"
              value={String(summary.data.salesCount)}
              foot="completed sales"
            />
            <StatCard
              label="Average sale"
              value={money(summary.data.averageSale)}
              foot="revenue ÷ sales"
            />
          </div>

          <SectionStrip
            title="Also in this period"
            info="Cost of goods is the sale-time cost of what left the shelf, not what it would cost to replace."
          >
            <FigureGrid>
              <Figure label="Cost of goods" value={money(summary.data.cogs)} />
              <Figure
                label="Discounts"
                value={money(summary.data.discountTotal)}
                foot="whole-sale and line discounts together"
              />
              <Figure
                label="Collected at sale"
                value={money(summary.data.collectedAtSale)}
                foot="cash taken at the till; debt repayments are on the debts report"
              />
              <Figure
                label="Credit issued"
                value={money(summary.data.creditIssued)}
                foot="counted in revenue above, but not yet received"
              />
              <Figure
                label="Voided"
                value={String(summary.data.voidedCount)}
                foot="matched on the sale's own date, not the date it was voided"
              />
              <Figure
                label="Voided value"
                value={money(summary.data.voidedAmount)}
                foot="already excluded from revenue"
              />
            </FigureGrid>
          </SectionStrip>
        </>
      ) : null}

      <SectionStrip
        title="Trend"
        info={
          trend.granularity === "day"
            ? "Every day in the period, zero-filled — a day with no sales is a gap in the bars, not a missing bar."
            : "Buckets start on the Monday (week) or the 1st (month), so the first bucket can begin before the period does and hold only part of its span."
        }
        actions={
          <>
            <Segmented
              label="Bucket size"
              options={GRANULARITIES}
              value={trend.granularity}
              onChange={(value) =>
                void setTrend({ granularity: value as TrendGranularity })
              }
            />
            <Segmented
              label="Series"
              options={METRICS}
              value={metric}
              onChange={setMetric}
            />
          </>
        }
      >
        {trendQuery.isPending ? (
          <Skeleton className="m-[18px] h-[200px] rounded-[8px]" />
        ) : trendQuery.data ? (
          <BarChart
            series={series}
            bucketLabels={trendQuery.data.series.map((bucket) =>
              bucketLabel(bucket.bucket, trendQuery.data.granularity),
            )}
            axisLabels={axisTicks(Math.max(0, ...series))}
            tone={activeMetric.tone as BarChartTone}
          />
        ) : (
          <p className="px-[18px] py-6 text-[13px] text-muted-foreground">
            The trend could not be loaded.
          </p>
        )}
      </SectionStrip>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionStrip
          title="How sales were paid"
          info="Share of the rows shown, and the amounts are accrual revenue — the same total as the Revenue card."
        >
          <MixPanel
            rows={zeroFilledStatuses(mix.data?.byPaymentStatus)}
            isPending={mix.isPending}
            money={money}
            valueLabel="Revenue"
          />
        </SectionStrip>

        <SectionStrip
          title="What was tendered"
          info="Cash collected at the till, grouped by the currency it was handed over in. Every amount is still in the business's main currency — there is no field carrying the tendered amount."
        >
          <MixPanel
            rows={(mix.data?.byCurrency ?? []).map((row) => ({
              ...row,
              label: `Tendered in ${row.label}`,
            }))}
            isPending={mix.isPending}
            money={money}
            valueLabel="Collected"
            empty="No cash was taken at the till in this period."
          />
        </SectionStrip>
      </div>
    </ReportShell>
  );
}

/**
 * The three payment statuses, always all three.
 *
 * **`byPaymentStatus` is not zero-filled** (§3.3): a period with no credit
 * sales simply has no `credit` row. A list that grew and shrank between
 * periods would make "no credit sales" look like a loading state, so the
 * missing rows are added back as zeros — which is what they are, not invented
 * data.
 */
function zeroFilledStatuses(
  rows: PaymentMixItem[] | undefined,
): PaymentMixItem[] {
  if (!rows) return [];
  return PAYMENT_STATUSES.map(
    (status) =>
      rows.find((row) => row.key === status) ?? {
        key: status,
        label: status,
        value: 0,
        share: 0,
        count: 0,
      },
  ).map((row) => ({
    ...row,
    // `label === key` on the wire — the raw enum, no humanisation.
    label:
      PAYMENT_STATUS_LABELS[row.key as (typeof PAYMENT_STATUSES)[number]] ??
      row.label,
  }));
}

function MixPanel({
  rows,
  isPending,
  money,
  valueLabel,
  empty = "Nothing to show for this period.",
}: {
  rows: PaymentMixItem[];
  isPending: boolean;
  money: (amount: number) => string;
  valueLabel: string;
  empty?: string;
}) {
  if (isPending) {
    return <Skeleton className="m-[18px] h-[120px] rounded-[8px]" />;
  }

  if (rows.length === 0) {
    return (
      <p className="px-[18px] py-6 text-[13px] text-muted-foreground">
        {empty}
      </p>
    );
  }

  return (
    <BreakdownRows
      valueLabel={valueLabel}
      rows={rows.map((row) => ({
        id: row.key,
        label: row.label,
        share: row.share,
        value: money(row.value),
        meta: `${row.count} ${row.count === 1 ? "sale" : "sales"}`,
      }))}
    />
  );
}
