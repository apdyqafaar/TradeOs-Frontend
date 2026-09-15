import type { SectionFigure, SeriesPoint } from "@/features/insights/types";
import { formatMoney, formatQuantity } from "@/lib/format/money";

/**
 * Rendering one `SectionFigure` — the model's own number, with its own unit.
 *
 * Pure, and deliberately free of any React import: every decision in here is
 * one the digest screen has already got wrong once somewhere in this product
 * (a symbol instead of a code, a fraction printed as a percentage, a tone
 * inferred from a label), and each of them is easier to pin in a unit test
 * than in a rendered tree.
 */

/**
 * `unit: "money"` carries **no currency**, exactly as no report payload does
 * (`features/reports/lib/format.ts`, "No report payload carries a currency
 * field — not one of the twelve"). The code comes from `useCurrencyConfig()`
 * and is threaded in by the screen.
 *
 * `currency` is `""` while the configuration is still loading, and
 * `formatMoney` then renders `" 1,846.50"` — trimmed here to a bare number, so
 * an amount is visibly incomplete rather than confidently labelled with a code
 * nobody has confirmed. Never a symbol: this market mixes currencies whose
 * symbols collide, which is the whole reason `formatMoney` takes a code.
 */
export function formatFigureValue(
  figure: SectionFigure,
  /** Only `unit: "money"` reads it, so the other three units need not pass one. */
  currency = "",
): string {
  const value = Number.isFinite(figure.value) ? figure.value : 0;

  switch (figure.unit) {
    case "money":
      return formatMoney(value, currency).trim();
    case "percent":
      return formatPercentPoints(value);
    case "days":
      // "1 day", "4 days" — a bare "4" beside the label "Cover" says nothing.
      return `${formatQuantity(value)} ${Math.abs(value) === 1 ? "day" : "days"}`;
    default:
      return formatQuantity(value);
  }
}

/**
 * **`unit: "percent"` and `deltaPct` are PERCENTAGE POINTS, not fractions**:
 * `27.7` is `"27.7%"`, and `0.94` is `"0.94%"` rather than `"94%"`.
 *
 * This is the opposite convention to the one live on `/reports`, where
 * `marginPct` and `share` are `0..1` fractions despite their names
 * (`features/reports/types.ts`) and rendering one raw printed "0.38%" over a
 * healthy margin. Two neighbouring screens with two conventions is exactly how
 * that bug happens twice, so the choice is written down here rather than
 * spread across the components, and **no heuristic guesses between them** — a
 * `value <= 1 ⇒ fraction` rule would print a genuine 0.8% margin as 80%.
 *
 * The convention follows the backend plan's own example
 * (`2026-09-15-digest-cost-and-presentation.md` §5: `value: 20320` for
 * `Revenue`, i.e. the figure as a reader would say it aloud) and the canvas,
 * which draws `+21.4%` and `27.7% margin`. It must be confirmed against the
 * shipped schema.
 */
function formatPercentPoints(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * `21.4` → `"+21.4%"`, `-54.3` → `"−54.3%"`, `0` → `"0.0%"`.
 *
 * The minus is U+2212 MINUS SIGN, as the canvas draws it — a hyphen next to
 * tabular mono figures reads as a dash rather than a sign. `null` when there
 * is no delta to draw, so a caller renders nothing rather than "undefined%" or
 * a bare "0%" that claims a comparison was made.
 */
export function formatDeltaPct(deltaPct: number | undefined): string | null {
  if (deltaPct === undefined || !Number.isFinite(deltaPct)) return null;
  if (deltaPct > 0) return `+${deltaPct.toFixed(1)}%`;
  if (deltaPct < 0) return `−${Math.abs(deltaPct).toFixed(1)}%`;
  return `${(0).toFixed(1)}%`;
}

/**
 * The words a direction arrow would otherwise have carried alone.
 *
 * `direction` is rendered as text — "up on", "down on" — rather than as a
 * glyph or a colour, for the reason the priority pill on this same page is
 * spelled out: colour and shape alone fail WCAG 1.4.1 and announce nothing.
 * `null` for `flat` and for absent, because "flat" beside a `0.0%` delta is
 * the same fact twice.
 */
export function directionWord(
  direction: SectionFigure["direction"],
): string | null {
  if (direction === "up") return "up";
  if (direction === "down") return "down";
  return null;
}

/**
 * Tone is the model's own judgement and is never derived from the label.
 *
 * "Overdue" rising is bad news and "Overdue" falling is good news, and the
 * word "Overdue" cannot tell a component which happened — which is exactly
 * what `tone` exists to say. An absent tone is `neutral`: unknown is not good.
 */
const TONE_TEXT: Record<NonNullable<SectionFigure["tone"]>, string> = {
  neutral: "text-foreground",
  good: "text-success-strong",
  warn: "text-warning-strong",
  bad: "text-destructive-strong",
};

/** The colour of the figure itself — the canvas draws Overdue in red, Low in amber. */
export function figureValueClass(figure: SectionFigure): string {
  return TONE_TEXT[figure.tone ?? "neutral"];
}

const TONE_DELTA: Record<NonNullable<SectionFigure["tone"]>, string> = {
  neutral: "text-muted-foreground",
  good: "text-success-strong",
  warn: "text-warning-strong",
  bad: "text-destructive-strong",
};

/** The colour of the delta line under a figure. Muted when the model said nothing. */
export function figureDeltaClass(figure: SectionFigure): string {
  return TONE_DELTA[figure.tone ?? "neutral"];
}

/**
 * `StatCard`'s three-value tone union, from the model's four.
 *
 * `warn` maps to `caution` rather than to `neutral`: a caution rendered as
 * "nothing in particular" is the one mapping that loses information, and the
 * digest's whole point is that a figure can be neither good nor catastrophic.
 */
export function statDeltaTone(
  figure: SectionFigure,
): "positive" | "negative" | "neutral" | "caution" {
  switch (figure.tone) {
    case "good":
      return "positive";
    case "bad":
      return "negative";
    case "warn":
      return "caution";
    default:
      return "neutral";
  }
}

/**
 * A series as the bare numbers `StatCard`/`BarChart` want, oldest first.
 *
 * `undefined` rather than `[]` for an absent or empty series: both of those
 * components treat an empty array as "draw an empty 36px gutter", and a
 * sparkline of nothing is worse than no sparkline.
 */
export function seriesValues(
  series: SeriesPoint[] | undefined,
): number[] | undefined {
  if (!series || series.length === 0) return undefined;
  return series.map((point) =>
    Number.isFinite(point.value) ? point.value : 0,
  );
}

/** The x-axis labels, in the same order as `seriesValues`. */
export function seriesLabels(series: SeriesPoint[] | undefined): string[] {
  return series?.map((point) => point.label) ?? [];
}

/**
 * The sentence a screen reader hears in place of the chart, and the `title` a
 * sighted reader gets on hover.
 *
 * `BarChart` builds its own `aria-label` from the raw numbers, which is right
 * for the Overview where the same figures are in a table beside it. Here the
 * series is money, so the label is built with the currency in it — "Mon USD
 * 1,846.50" rather than "Mon 1846.5".
 */
export function seriesSummary(
  series: SeriesPoint[],
  format: (value: number) => string,
): string {
  return series
    .map((point) => `${point.label} ${format(point.value)}`)
    .join(", ");
}
