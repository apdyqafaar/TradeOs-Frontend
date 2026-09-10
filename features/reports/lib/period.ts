import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import type { PeriodEcho, PeriodParams } from "@/features/reports/types";
import { formatDate } from "@/lib/format/date";
import { rangeIssue } from "@/lib/period";

/**
 * The period the six report screens share, held in the URL.
 *
 * One module rather than one per screen: a reader who sets "This year" on the
 * sales report and clicks through to Staff expects to still be in this year,
 * and that only works if all six read and write the same three query keys.
 *
 * The API's own rules are in `lib/period.ts` (the 366-day cap, the three 400
 * codes, `to` inclusive). This file is only the URL half.
 */

/**
 * The five choices the bar offers.
 *
 * Four are the API's presets; `custom` is **this screen's** word for
 * `from`+`to` and is never sent — `periodQueryFields` is `.strict()` with a
 * four-member enum, so `period=custom` would be a 422 rather than an ignored
 * key (`docs/contracts/reports.md` §1.1).
 *
 * **There is no "All time".** Every period-taking report falls through to
 * `period ?? "month"` server-side (§1.5), so omitting the dates does not mean
 * "everything", it means "this month" — an option labelled All time would
 * quietly report one month.
 */
export const REPORT_PERIOD_OPTIONS = [
  "today",
  "week",
  "month",
  "year",
  "custom",
] as const;

export type ReportPeriodOption = (typeof REPORT_PERIOD_OPTIONS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriodOption, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
  custom: "Custom",
};

/**
 * `month` is the default because it is the **server's** default. nuqs drops a
 * key whose value equals its default, so `/reports` with nothing chosen has a
 * bare query string and still describes exactly what the API will do.
 */
const REPORT_PERIOD_PARSERS = {
  period: parseAsStringLiteral(REPORT_PERIOD_OPTIONS).withDefault("month"),
  from: parseAsString.withDefault(""),
  to: parseAsString.withDefault(""),
};

/**
 * `history: "replace"` so a period click does not stack a history entry, and
 * `scroll: false` so committing one does not throw the reader back to the top
 * of a report they had scrolled into.
 */
export function useReportPeriod() {
  return useQueryStates(REPORT_PERIOD_PARSERS, {
    history: "replace",
    scroll: false,
  });
}

export type ReportPeriod = ReturnType<typeof useReportPeriod>[0];
export type SetReportPeriod = ReturnType<typeof useReportPeriod>[1];

/**
 * URL state → the query the wire wants, and the two places they disagree.
 *
 *   - `period` and `from`/`to` are **mutually exclusive** and `from`/`to` must
 *     be sent together (§1.1). Both are 422s, and a range picker exists in the
 *     half-filled state for as long as it takes to click twice.
 *   - An unusable range — incomplete, not a real date, reversed, or over the
 *     366-day cap — is dropped back to the **month preset** rather than posted
 *     as a guaranteed 400. `{}` would be the same request, but naming the
 *     preset is what makes the screen's caption honest about what is on it.
 *
 * Done here rather than in the service because this object is also the React
 * Query key: `{ period: undefined }` and `{}` hash differently for one
 * identical request.
 */
export function toPeriodParams(period: ReportPeriod): PeriodParams {
  if (period.period !== "custom") return { period: period.period };
  if (rangeIssue(period.from, period.to) !== null) return { period: "month" };
  return { from: period.from, to: period.to };
}

/** True when the chosen range cannot be sent, so the screen can say which figures it is showing instead. */
export function hasUnusableRange(period: ReportPeriod): boolean {
  return (
    period.period === "custom" && rangeIssue(period.from, period.to) !== null
  );
}

/**
 * The window a report actually covered, from its own echo — `01 Sep – 07 Sep
 * 2026`.
 *
 * Read off the response rather than off the picker, because the server is the
 * one that resolved it: `week` starts on **Monday** in the business's zone, and
 * `month` is the whole calendar month including days that have not happened
 * yet. A caption built from the picker would have to re-derive all of that and
 * could only ever be a second opinion.
 *
 * **`echo.to` is the EXCLUSIVE bound** (§1.6), so the last day shown is the
 * one containing the instant a millisecond before it. Subtracting a
 * millisecond rather than a day is what keeps that true across a DST boundary,
 * where "the previous day" is not always 24 hours earlier.
 */
export function formatPeriodEcho(echo: PeriodEcho, timezone: string): string {
  const lastDay = new Date(new Date(echo.to).getTime() - 1);
  const start = formatDate(echo.from, timezone);
  const end = formatDate(lastDay, timezone);
  return start === end ? start : `${start} – ${end}`;
}
