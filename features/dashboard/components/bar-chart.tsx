import { cn } from "cn";

/** Which series is on screen. Maps to the chart tokens, so dark mode lifts with the palette. */
export type BarChartTone = "primary" | "muted" | "info" | "warning" | "success";

interface BarChartProps {
  /** The values, oldest first. One entry per bucket, same length as `bucketLabels`. */
  series: number[];
  /**
   * The y-axis ticks, **top first**, already formatted by the caller — this
   * component never formats, for the same reason `StatCard` does not: only the
   * caller knows the currency.
   */
  axisLabels: string[];
  /** The x-axis labels, one per bucket, in the same order as `series`. */
  bucketLabels: string[];
  tone?: BarChartTone;
  /** Plot height in pixels. The canvas draws 176 on the Overview, 140 in the specimen sheet. */
  height?: number;
  className?: string;
}

const TONE_CLASS: Record<BarChartTone, string> = {
  primary: "bg-chart-1",
  muted: "bg-chart-2",
  info: "bg-chart-3",
  warning: "bg-chart-4",
  success: "bg-chart-5",
};

/**
 * The Overview's trend chart (design canvas artboard `1c`): bars on a
 * four-line horizontal grid, a right-aligned axis column, and bucket labels
 * underneath.
 *
 * Deliberately not a charting library. It draws one non-interactive series
 * from an array of numbers, which is all the Overview asks for; pulling in a
 * chart runtime for that would cost more bundle than the whole feature slice.
 *
 * Accessibility: the wrapper is one `img` with a label listing every bucket
 * and value, and each bar is `role="presentation"`. Announcing seven unlabelled
 * rectangles helps nobody, and the same figures are always on the page in text
 * beside or beneath the chart.
 */
export function BarChart({
  series,
  axisLabels,
  bucketLabels,
  tone = "primary",
  height = 176,
  className,
}: BarChartProps) {
  // `Math.max(0, ...)` rather than `Math.max(...series)`: an empty series
  // would otherwise give `-Infinity`, and every bar `height: -Infinity%`.
  const max = Math.max(0, ...series);

  const buckets = series.map((value, index) => ({
    // Position is the identity — bucket 3 is bucket 3 whatever it is called,
    // buckets never reorder, and two days can share a label ("Mon" twice on a
    // fortnight view), which would collide if the label were the key.
    key: `bucket-${index}`,
    label: bucketLabels[index] ?? "",
    value,
    // The guard the whole component exists to get right: an all-zero series is
    // day one of every business, and `0 / 0` is NaN. React writes `NaN%` into
    // the style, the browser drops it, and the bars silently inherit whatever
    // height they had — so clamp to a flat baseline instead. Negatives (a
    // loss-making profit bucket) clamp to zero too: there is no axis below the
    // baseline to draw them against.
    percent: max > 0 ? Math.max(0, (value / max) * 100) : 0,
  }));

  const axisTicks = axisLabels.map((label, index) => ({
    key: `axis-${index}`,
    label,
  }));

  const summary = buckets
    .map((bucket) => `${bucket.label} ${bucket.value}`)
    .join(", ");

  return (
    <div
      data-slot="bar-chart"
      role="img"
      aria-label={`Bar chart. ${summary}`}
      className={cn("flex gap-3.5 px-[18px] pt-[22px] pb-[18px]", className)}
    >
      <div
        className="flex flex-none flex-col justify-between text-right"
        style={{ height }}
      >
        {axisTicks.map((tick) => (
          <span
            key={tick.key}
            className="font-mono text-[10px] leading-none text-muted-3"
          >
            {tick.label}
          </span>
        ))}
      </div>

      <div className="flex flex-1 flex-col gap-2.5">
        <div
          className="flex items-end gap-5 border-b border-surface-3"
          style={{
            height,
            // The four horizontal rules the canvas draws behind the bars. A
            // repeating background rather than four elements, so the grid
            // cannot drift out of step with the plot height.
            backgroundImage:
              "linear-gradient(to top, var(--color-border) 1px, transparent 1px)",
            backgroundSize: "100% 25%",
          }}
        >
          {buckets.map((bucket) => (
            <div
              key={bucket.key}
              className="flex h-full flex-1 flex-col items-center justify-end"
            >
              <span
                role="presentation"
                style={{ height: `${bucket.percent}%` }}
                className={cn(
                  "w-full max-w-[56px] rounded-t-[6px]",
                  TONE_CLASS[tone],
                )}
              />
            </div>
          ))}
        </div>

        <div className="flex gap-5">
          {buckets.map((bucket) => (
            <span
              key={bucket.key}
              className="flex-1 text-center font-mono text-[10px] tracking-[0.06em] text-muted-foreground"
            >
              {bucket.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
