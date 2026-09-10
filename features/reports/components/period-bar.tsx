"use client";

import { cn } from "cn";
import { CalendarRange } from "lucide-react";
import {
  formatPeriodEcho,
  REPORT_PERIOD_LABELS,
  REPORT_PERIOD_OPTIONS,
  type ReportPeriod,
  type ReportPeriodOption,
  type SetReportPeriod,
} from "@/features/reports/lib/period";
import type { PeriodEcho } from "@/features/reports/types";
import { RANGE_MESSAGES, rangeIssue } from "@/lib/period";

interface PeriodBarProps {
  period: ReportPeriod;
  setPeriod: SetReportPeriod;
  /**
   * The echo off whichever request on the screen carries one, so the caption
   * says what the **server** resolved rather than what the picker asked for.
   * `undefined` while the first request is in flight, and on the two screens
   * whose endpoints echo nothing.
   */
  echo?: PeriodEcho;
  /** The business's IANA zone — the day boundary every figure on the page uses. */
  timezone: string;
  /** True when the API refused the range with one of the three period 400s. */
  refused?: boolean;
  className?: string;
}

const SEGMENT =
  "flex h-8 items-center rounded-[8px] px-3.5 text-[13px] transition-colors";

/**
 * The period bar of design artboard `2i`
 * (`docs/design/TradeOs-UI.dc.html:1102-1112`): the preset segments, a date
 * range, and the business timezone named beside them.
 *
 * **The timezone is on the bar, not in a footnote.** Every report resolves
 * `today`, `week` and `month` in the organization's zone, never the reader's
 * (`docs/contracts/reports.md` §1.5) — so an owner in London reading a Nairobi
 * shop's "Today" is being shown Nairobi's day, and the only honest place to
 * say that is next to the control that chose it.
 *
 * The canvas draws the resolved range as a second chip that looks like a
 * button. It is rendered as **text**, because it is not one: the range is an
 * output of the request, and the thing that changes it is the segments to its
 * left. A chip that looked pressable and was not would be a worse answer than
 * a line of type.
 */
export function PeriodBar({
  period,
  setPeriod,
  echo,
  timezone,
  refused = false,
  className,
}: PeriodBarProps) {
  const issue =
    period.period === "custom" ? rangeIssue(period.from, period.to) : null;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-3">
        {/* A fieldset, not a div with role="group": the five buttons are one
            choice, and the legend names that choice to a screen reader without
            printing a label the canvas does not draw. */}
        <fieldset className="flex rounded-[10px] border border-border bg-surface-2 p-[3px]">
          <legend className="sr-only">Reporting period</legend>
          {REPORT_PERIOD_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === period.period}
              onClick={() => {
                // Switching to a preset leaves `from`/`to` in the URL and the
                // inputs, so going back to Custom finds the range still there.
                // Nothing sends both — `toPeriodParams` picks one — and the
                // pair are mutually exclusive on the wire, so clearing them
                // here would only cost the reader their dates.
                void setPeriod({ period: option as ReportPeriodOption });
              }}
              className={cn(
                SEGMENT,
                option === period.period
                  ? "bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(31,30,29,0.06)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {REPORT_PERIOD_LABELS[option]}
            </button>
          ))}
        </fieldset>

        {period.period === "custom" ? (
          <div className="flex flex-wrap items-center gap-2">
            {/*
              `type="date"` because the control's native value **is** what the
              API wants: a bare `YYYY-MM-DD` calendar date, and both ends are
              inclusive. A client that "compensated" for an exclusive bound by
              sending `to + 1` would over-select by a whole day
              (`docs/contracts/reports.md` §1.4).
            */}
            <label className="sr-only" htmlFor="report-from">
              From date
            </label>
            <input
              id="report-from"
              type="date"
              value={period.from}
              max={period.to === "" ? undefined : period.to}
              onChange={(event) => void setPeriod({ from: event.target.value })}
              aria-invalid={issue !== null ? true : undefined}
              className="h-[38px] rounded-[10px] border border-border bg-card px-3 font-mono text-[13px] text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            />
            <span aria-hidden="true" className="text-xs text-muted-foreground">
              to
            </span>
            <label className="sr-only" htmlFor="report-to">
              To date
            </label>
            <input
              id="report-to"
              type="date"
              value={period.to}
              min={period.from === "" ? undefined : period.from}
              onChange={(event) => void setPeriod({ to: event.target.value })}
              aria-invalid={issue !== null ? true : undefined}
              className="h-[38px] rounded-[10px] border border-border bg-card px-3 font-mono text-[13px] text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            />
          </div>
        ) : null}

        {echo ? (
          <span className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <CalendarRange
              className="size-[15px] text-muted-3"
              aria-hidden="true"
            />
            {formatPeriodEcho(echo, timezone)}
          </span>
        ) : null}

        <span className="font-mono text-[11px] text-muted-3">
          business timezone · {timezone}
        </span>
      </div>

      {/*
        One caption, and only when it has something to say. The refusal wins
        over the client-side complaint: if the server has already answered 400
        then the range left the browser, and repeating the guard's wording
        would describe a check that plainly did not stop it.
      */}
      {refused ? (
        <p role="alert" className="text-[12px] text-destructive">
          The API refused that range. Reports cover at most 366 days, and both
          dates must be real calendar dates with the start on or before the end.
        </p>
      ) : issue !== null ? (
        <p role="alert" className="text-[12px] text-destructive">
          {RANGE_MESSAGES[issue]} Showing this month until it is fixed.
        </p>
      ) : period.period === "custom" ? (
        <p className="text-[12px] text-muted-foreground">
          Both dates are included, so the end date is the last day counted.
        </p>
      ) : null}
    </div>
  );
}
