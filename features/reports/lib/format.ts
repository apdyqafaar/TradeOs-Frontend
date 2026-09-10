import { formatMoney } from "@/lib/format/money";

/** Pre-bound `formatMoney(amount, currency)` — the screen owns the currency, not the panel. */
export type MoneyFormatter = (amount: number) => string;

/**
 * The currency, decided once per screen.
 *
 * **No report payload carries a currency field — not one of the twelve**
 * (`docs/contracts/reports.md` §6). Every amount is a bare number in the
 * organization's main currency, so the code comes from `useOrganization()` and
 * is bound here rather than passed to every panel.
 *
 * `currency` is `""` when the business has no currency configuration, which is
 * a real state (`organization.currency` is nullable on the wire). `formatMoney`
 * then renders `" 4,120.25"`, trimmed here to a bare number — visibly
 * incomplete rather than confidently wrong, which is the whole point of this
 * repo's no-hardcoded-currency rule. `CurrencyNotice` says why, out loud.
 */
export const moneyIn =
  (currency: string): MoneyFormatter =>
  (amount: number) =>
    formatMoney(amount, currency).trim();

/**
 * A `round4` fraction as a percentage — `0.3769` → `"37.7%"`.
 *
 * Both `share` and `marginPct` are fractions despite their names
 * (`shapes.ts:48`, `sales.report.ts:106`), and rendering one raw prints
 * "0.38%" over a healthy margin. One decimal place, because the underlying
 * figure carries four and printing all of them implies a precision the
 * aggregate does not have.
 */
export const percentOf = (fraction: number): string =>
  `${(Number.isFinite(fraction) ? fraction * 100 : 0).toFixed(1)}%`;

/**
 * `20320` → `"20.3k"`, for a chart's axis gutter.
 *
 * Deliberately compact rather than `formatMoney`'s full `USD 20,320.00`: the
 * canvas's axis column is a narrow 10px mono gutter and the full form is four
 * times its width. The unit is not lost — it is named once in the legend
 * beside the chart title, which is where a reader looks for what a chart
 * counts.
 */
export function compactNumber(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/**
 * Five evenly spaced axis ticks, top first, in the shape `BarChart` wants.
 *
 * The Overview has a private twin of this in
 * `features/dashboard/components/sales-section.tsx`; it is not exported, and
 * reaching into a `"use client"` component module for a pure function would be
 * a worse coupling than the twelve lines. Both produce identical ticks, which
 * is what keeps the two screens' charts reading as one chart language.
 */
export function axisTicks(max: number): string[] {
  // A flat series still needs a labelled baseline, or the gutter is five zeroes.
  const top = max > 0 ? max : 1;
  return [1, 0.75, 0.5, 0.25, 0].map((fraction) =>
    compactNumber(top * fraction),
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * A trend bucket key as an axis label.
 *
 * `bucket` is a **label the server already resolved in the business timezone**,
 * not an instant: `yyyy-MM-dd` at day and week granularity, `yyyy-MM` at month.
 * Feeding it to `formatDate` would re-read it as UTC midnight and can name the
 * previous day west of Greenwich, so the parts are rebuilt as a local calendar
 * date and only the weekday is taken from it.
 *
 * Day granularity shows a weekday; **week and month show the raw key**. A week
 * bucket is also a `yyyy-MM-dd` — the Monday — and the two are indistinguishable
 * by shape (§3.2), so only the requested granularity can tell them apart, and
 * printing "Mon" over every one of them would say nothing.
 */
export function bucketLabel(bucket: string, granularity: string): string {
  if (granularity !== "day") return bucket;
  const [year, month, day] = bucket.split("-").map(Number);
  if (!year || !month || !day) return bucket;
  return WEEKDAYS[new Date(year, month - 1, day).getDay()] ?? bucket;
}
