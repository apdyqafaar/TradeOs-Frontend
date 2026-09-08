"use client";

import { cn } from "cn";
import { useState } from "react";
import {
  BarChart,
  type BarChartTone,
} from "@/features/dashboard/components/bar-chart";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import { StatCard } from "@/features/dashboard/components/stat-card";
import type { DashboardSalesSection } from "@/features/dashboard/types";

/** Pre-bound `formatMoney(amount, currency)` — the page owns the currency, not the panel. */
type MoneyFormatter = (amount: number) => string;

interface SalesStatCardsProps {
  section: DashboardSalesSection;
  money: MoneyFormatter;
}

/**
 * The four-column stat grid of design canvas artboard `1c`.
 *
 * `sales` carries six numbers — revenue, gross profit and count for both today
 * and the month to date — and the canvas draws four cards, so two of them
 * ride in a footer rather than being dropped: the month's count as the delta
 * and the month's gross profit as the foot note. Nothing here is a computed
 * comparison against a period the API did not send. The canvas's `+0.94% vs
 * last week` would have to be invented from `trend7`, whose last bucket is
 * *today so far* — comparing a partial day with a whole one reads as a
 * collapse every morning.
 */
export function SalesStatCards({ section, money }: SalesStatCardsProps) {
  const { today, thisMonth, trend7 } = section;

  // Gross margin is the one derived figure on the grid, and it is derived from
  // the two numbers already printed on the same card, so it cannot disagree
  // with anything else on the page.
  const margin =
    today.revenue > 0 ? (today.grossProfit / today.revenue) * 100 : null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Today's revenue"
        value={money(today.revenue)}
        spark={trend7.series.map((bucket) => bucket.revenue)}
        foot="last 7 days"
      />
      <StatCard
        label="Today's profit"
        value={money(today.grossProfit)}
        delta={margin === null ? undefined : `${margin.toFixed(1)}%`}
        deltaTone={today.grossProfit < 0 ? "negative" : "positive"}
        foot="gross margin"
      />
      <StatCard
        label="Sales today"
        value={String(today.count)}
        spark={trend7.series.map((bucket) => bucket.count)}
        foot="completed sales"
      />
      <StatCard
        label="This month"
        value={money(thisMonth.revenue)}
        delta={`${thisMonth.count} sales`}
        foot={`profit ${money(thisMonth.grossProfit)}`}
      />
    </div>
  );
}

/** The three series the segmented control switches between. */
const METRICS = [
  { key: "revenue", label: "Revenue", tone: "primary", money: true },
  { key: "profit", label: "Profit", tone: "success", money: true },
  { key: "count", label: "Count", tone: "info", money: false },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

/** The legend dot has to match `BarChart`'s bar, so both read from the tone. */
const LEGEND_DOT: Record<BarChartTone, string> = {
  primary: "bg-chart-1",
  muted: "bg-chart-2",
  info: "bg-chart-3",
  warning: "bg-chart-4",
  success: "bg-chart-5",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * `bucket` is a *label* the server already resolved in the business timezone
 * (`yyyy-MM-dd` at day granularity), not an instant. Feeding it to
 * `formatDate` would re-read it as UTC midnight and can name the previous day
 * west of Greenwich, so the parts are rebuilt as a local calendar date and only
 * the weekday is taken from it. Anything that is not three numeric parts —
 * `trend7` always answers `day`, but the shape is `getSalesTrend`'s and the
 * Reports pages reuse it monthly — falls through to the raw label.
 */
function bucketLabel(bucket: string): string {
  const [year, month, day] = bucket.split("-").map(Number);
  if (!year || !month || !day) return bucket;
  return WEEKDAYS[new Date(year, month - 1, day).getDay()] ?? bucket;
}

/**
 * Five evenly spaced axis ticks, top first, in the shape `BarChart` wants.
 *
 * Deliberately compact (`20.3k`) rather than `formatMoney`'s full
 * `USD 20,320.00`: the canvas's axis column is a narrow 10px mono gutter and
 * the full form is four times its width. The unit is not lost — it is stated
 * once in the legend beside the chart title, which is where a reader looks for
 * what a chart is counting.
 */
function axisTicks(max: number): string[] {
  const compact = (value: number): string => {
    const magnitude = Math.abs(value);
    if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (magnitude >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return String(Math.round(value));
  };
  // A flat series still needs a labelled baseline, or the gutter is five zeroes.
  const top = max > 0 ? max : 1;
  return [1, 0.75, 0.5, 0.25, 0].map((fraction) => compact(top * fraction));
}

interface SalesTrendSectionProps {
  section: DashboardSalesSection;
  /** The business's currency code, or `""` when it has none configured. */
  currency: string;
}

/**
 * The sales-trend strip of artboard `1c`: a legend, a `Revenue · Profit ·
 * Count` segmented control and seven bars.
 *
 * The canvas also draws a `…` menu to the right of the control. It is left out
 * rather than rendered inert — nothing in this slice can be behind it, and a
 * button that does nothing is a worse answer than no button.
 */
export function SalesTrendSection({
  section,
  currency,
}: SalesTrendSectionProps) {
  const [metric, setMetric] = useState<MetricKey>("revenue");
  const active = METRICS.find((entry) => entry.key === metric) ?? METRICS[0];

  const series = section.trend7.series.map((bucket) => bucket[metric]);
  const bucketLabels = section.trend7.series.map((bucket) =>
    section.trend7.granularity === "day"
      ? bucketLabel(bucket.bucket)
      : bucket.bucket,
  );

  const unit = active.money && currency ? ` · ${currency}` : "";

  return (
    <SectionStrip
      title="Sales trend · last 7 days"
      info="Completed sales only, bucketed by the business's own calendar day."
      actions={
        <>
          <span className="hidden items-center gap-1.5 sm:flex">
            <span
              aria-hidden="true"
              className={cn("size-[7px] rounded-full", LEGEND_DOT[active.tone])}
            />
            <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
              {active.label}
              {unit}
            </span>
          </span>

          {/* A fieldset, not a div with role="group": the three buttons are one
              choice, and the legend is what names that choice to a screen
              reader without printing a label the canvas does not draw. */}
          <fieldset className="flex rounded-[9px] border border-border bg-surface-2 p-0.5">
            <legend className="sr-only">Trend metric</legend>
            {METRICS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={entry.key === metric}
                onClick={() => setMetric(entry.key)}
                className={cn(
                  "flex h-[26px] items-center rounded-[7px] px-3 text-xs transition-colors",
                  entry.key === metric
                    ? "bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(31,30,29,0.06)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            ))}
          </fieldset>
        </>
      }
    >
      <BarChart
        series={series}
        bucketLabels={bucketLabels}
        axisLabels={axisTicks(Math.max(0, ...series))}
        tone={active.tone}
      />
    </SectionStrip>
  );
}
