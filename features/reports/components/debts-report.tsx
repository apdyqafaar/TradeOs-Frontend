"use client";

import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart } from "@/features/dashboard/components/bar-chart";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { BreakdownRows } from "@/features/reports/components/breakdown-rows";
import { Figure, FigureGrid } from "@/features/reports/components/figure-grid";
import { ReportShell } from "@/features/reports/components/report-shell";
import {
  useDebtsAgeing,
  useDebtsSummary,
} from "@/features/reports/hooks/use-reports";
import { axisTicks, moneyIn } from "@/features/reports/lib/format";
import { toPeriodParams, useReportPeriod } from "@/features/reports/lib/period";
import { isPeriodError } from "@/lib/period";

/**
 * The debts report — `/reports/debts`, artboard `2i`'s lower right panel.
 *
 * The screen is built around one awkward fact: **half of `debts/summary`
 * ignores the period it echoes** (`docs/contracts/reports.md` §3.8). Four
 * figures describe this moment and four describe the chosen window, and each
 * of those four keys off a *different* date field. Filing all eight under one
 * "September" heading would be lying about four of them, so they are two
 * panels with two headings that each say when they are true.
 *
 * The ageing ladder is a third request and is point-in-time as well.
 */
export function DebtsReport() {
  const [period, setPeriod] = useReportPeriod();
  const params = toPeriodParams(period);

  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();
  const money = moneyIn(currency);

  const summary = useDebtsSummary(params);
  const ageing = useDebtsAgeing();

  if (summary.error?.status === 403 || ageing.error?.status === 403) {
    return <ForbiddenScreen />;
  }

  const refused = summary.error !== null && isPeriodError(summary.error);
  const buckets = ageing.data?.items ?? [];

  return (
    <ReportShell
      title="Debts report"
      period={period}
      setPeriod={setPeriod}
      echo={summary.data?.period}
      refused={refused}
      timezone={timezone}
      currency={currency}
      organizationLoading={organizationLoading}
    >
      {summary.error && !refused ? <ErrorCard error={summary.error} /> : null}

      <SectionStrip
        title="Right now · not the selected period"
        info="These four are as of the moment you loaded the page. Changing the period does not move them."
      >
        {summary.isPending || organizationLoading ? (
          <Skeleton className="m-[18px] h-[100px] rounded-[8px]" />
        ) : summary.data ? (
          <FigureGrid>
            <Figure
              label="Outstanding"
              value={money(summary.data.outstanding)}
              foot="still owed on open debts"
            />
            <Figure label="Open debts" value={String(summary.data.openCount)} />
            <Figure
              label="Overdue"
              value={money(summary.data.overdueAmount)}
              foot="open debts past their due date"
            />
            <Figure
              label="Overdue debts"
              value={String(summary.data.overdueCount)}
            />
          </FigureGrid>
        ) : (
          <p className="px-[18px] py-6 text-[13px] text-muted-foreground">
            The debts summary could not be loaded.
          </p>
        )}
      </SectionStrip>

      <SectionStrip
        title="In the selected period"
        info="Each of these four is dated by a different event — when the debt was issued, when a repayment landed, when it was written off, when it was cancelled — so they do not describe one set of debts."
      >
        {summary.isPending || organizationLoading ? (
          <Skeleton className="m-[18px] h-[100px] rounded-[8px]" />
        ) : summary.data ? (
          <FigureGrid>
            <Figure
              label="New debt"
              value={money(summary.data.newDebt)}
              foot="issued in the period, including debts later cancelled or written off"
            />
            <Figure
              label="Collected"
              value={money(summary.data.collected)}
              foot="debt repayments only — money taken at the till is on the sales report"
            />
            <Figure
              label="Written off"
              value={money(summary.data.writtenOff)}
              foot="dated by the write-off, not by the debt"
            />
            <Figure
              label="Cancelled"
              value={money(summary.data.cancelledAmount)}
              foot="the full principal of debts voided with their sale"
            />
          </FigureGrid>
        ) : null}
      </SectionStrip>

      <SectionStrip
        title="Ageing · point in time"
        info="Every open debt, laddered by how long it has been overdue. A debt overdue by an hour is already in 1–30, never Current: the split is whether the due date has passed, not a day count."
      >
        {ageing.isPending || organizationLoading ? (
          <Skeleton className="m-[18px] h-[200px] rounded-[8px]" />
        ) : ageing.data ? (
          <>
            {/*
              Rendered in array order and never re-sorted. This is the one
              breakdown in the feature that is NOT sorted by value: the API
              returns the five keys in ladder order, always all five, always
              zero-filled, which is what its `ordered: true` announces (§3.9).
            */}
            <BarChart
              series={buckets.map((bucket) => bucket.value)}
              bucketLabels={buckets.map((bucket) => bucket.key)}
              axisLabels={axisTicks(
                Math.max(0, ...buckets.map((bucket) => bucket.value)),
              )}
              tone="warning"
              height={150}
            />
            <BreakdownRows
              valueLabel="Outstanding"
              className="border-t border-border"
              rows={buckets.map((bucket) => ({
                id: bucket.key,
                label: bucket.label,
                share: bucket.share,
                value: money(bucket.value),
                meta: `${bucket.count} ${bucket.count === 1 ? "debt" : "debts"}`,
              }))}
            />
          </>
        ) : (
          <p className="px-[18px] py-6 text-[13px] text-muted-foreground">
            The ageing ladder could not be loaded.
          </p>
        )}
      </SectionStrip>
    </ReportShell>
  );
}
