"use client";

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
import { Figure, FigureGrid } from "@/features/reports/components/figure-grid";
import { ReportShell } from "@/features/reports/components/report-shell";
import { Segmented } from "@/features/reports/components/segmented";
import { useReportsDashboard } from "@/features/reports/hooks/use-reports";
import {
  axisTicks,
  bucketLabel,
  moneyIn,
  percentOf,
} from "@/features/reports/lib/format";
import { toPeriodParams, useReportPeriod } from "@/features/reports/lib/period";
import { isPeriodError } from "@/lib/period";

/** The three series the chart switches between. All three are in every bucket. */
const METRICS = [
  { value: "revenue", label: "Revenue", tone: "primary", money: true },
  { value: "profit", label: "Profit", tone: "success", money: true },
  { value: "count", label: "Count", tone: "info", money: false },
] as const;

type MetricKey = (typeof METRICS)[number]["value"];

/**
 * The reports hub — `/reports`, artboard `2i`'s upper half.
 *
 * One request: **`GET /reports/dashboard`**, not `GET /dashboard`. The two
 * differ in permission (`reports:view` vs `organization:view`), in parameters
 * (a period vs none at all) and in shape, and they return the identical
 * success message `"Dashboard fetched"`, which is what makes crossing them so
 * easy (`docs/contracts/reports.md` §5). The Overview owns the other one.
 *
 * Bare `GET /reports` is a byte-for-byte alias of this endpoint (§3.12) and is
 * deliberately unused: one request under two names would be two cache entries
 * for one answer.
 */
export function ReportsHub() {
  const [period, setPeriod] = useReportPeriod();
  const params = toPeriodParams(period);
  const [metric, setMetric] = useState<MetricKey>("revenue");

  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();
  const money = moneyIn(currency);

  const { data, error, isPending } = useReportsDashboard(params);

  // Nothing broke — the caller simply may not read this. `requirePageAccess`
  // already gated the route server-side, so arriving here means a role changed
  // between the two.
  if (error?.status === 403) return <ForbiddenScreen />;

  const refused = error !== null && isPeriodError(error);
  const active = METRICS.find((entry) => entry.value === metric) ?? METRICS[0];

  return (
    <ReportShell
      title="Reports"
      period={period}
      setPeriod={setPeriod}
      echo={data?.period}
      refused={refused}
      timezone={timezone}
      currency={currency}
      organizationLoading={organizationLoading}
    >
      {/*
        A period 400 is already explained on the bar, under the control that
        caused it, so the page does not repeat itself with a red card as well.
        Retrying would post the same rejected range.
      */}
      {error && !refused ? <ErrorCard error={error} /> : null}

      {isPending || organizationLoading ? <HubSkeleton /> : null}

      {data && !organizationLoading ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Revenue"
              value={money(data.revenue)}
              spark={data.trend.map((bucket) => bucket.revenue)}
              foot="credit sales counted in full"
            />
            <StatCard
              label="Gross profit"
              value={money(data.grossProfit)}
              // The one derived figure on the grid, and derived from two
              // numbers printed on the same card — so it cannot disagree with
              // anything else on the page. `/reports/dashboard` carries no
              // `marginPct` of its own; `sales/summary` does.
              delta={
                data.revenue > 0
                  ? percentOf(data.grossProfit / data.revenue)
                  : undefined
              }
              deltaTone={data.grossProfit < 0 ? "negative" : "positive"}
              foot="gross margin"
            />
            <StatCard
              label="Sales"
              value={String(data.salesCount)}
              spark={data.trend.map((bucket) => bucket.count)}
              foot="completed sales"
            />
            <StatCard
              label="Collected"
              value={money(data.collected)}
              foot="till cash + debt repayments"
            />
          </div>

          <SectionStrip
            title="Trend · daily"
            info="Completed sales, bucketed by the business's own calendar day. This chart is always daily — GET /reports/dashboard has no granularity parameter."
            actions={
              <Segmented
                label="Trend metric"
                options={METRICS}
                value={metric}
                onChange={setMetric}
              />
            }
          >
            <BarChart
              series={data.trend.map((bucket) => bucket[metric])}
              bucketLabels={data.trend.map((bucket) =>
                bucketLabel(bucket.bucket, "day"),
              )}
              axisLabels={axisTicks(
                Math.max(0, ...data.trend.map((bucket) => bucket[metric])),
              )}
              tone={active.tone as BarChartTone}
            />
          </SectionStrip>

          {/*
            Four of the ten numbers in this payload ignore the period they sit
            beside (§3.11). Putting them under one "September" heading with the
            rest would be lying about four of them, so they get their own strip
            and their own heading that says when they are true.
          */}
          <SectionStrip
            title="Right now · not the selected period"
            info="These four describe the moment you loaded the page. Changing the period does not move them."
          >
            <FigureGrid>
              <Figure label="Outstanding" value={money(data.outstanding)} />
              <Figure label="Overdue" value={money(data.overdueAmount)} />
              <Figure
                label="Overdue debts"
                value={String(data.overdueCount)}
                foot="open debts past their due date"
              />
              <Figure
                label="Low stock"
                value={String(data.lowStockCount)}
                foot="tracked products at or under their threshold"
              />
            </FigureGrid>
          </SectionStrip>
        </>
      ) : null}
    </ReportShell>
  );
}

/** The loading state in the shape of the page, never a spinner. */
function HubSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {["a", "b", "c", "d"].map((key) => (
          <Skeleton key={key} className="h-[118px] rounded-[10px]" />
        ))}
      </div>
      <Skeleton className="h-[268px] rounded-[10px]" />
      <Skeleton className="h-[150px] rounded-[10px]" />
    </>
  );
}
