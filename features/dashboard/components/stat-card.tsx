import { cn } from "cn";
import { Info } from "lucide-react";

/** How the delta reads, not what it says — the caller decides the sign and the words. */
export type StatDeltaTone = "positive" | "negative" | "neutral";

interface StatCardProps {
  /** Mono, uppercase, tracked. Short — "Today's revenue", not a sentence. */
  label: string;
  /**
   * **Already formatted.** Pass `formatMoney(amount, currency)` or a plain
   * count string; this component never formats. Only the caller knows whether
   * a number is money, a quantity or a count, and which currency the business
   * keeps its books in — a `formatMoney` call in here would have to guess, and
   * a guessed `"USD"` is a wrong number rather than a missing one.
   */
  value: string;
  /**
   * A small trailing series drawn as a bar sparkline, oldest first. Scaled
   * against its own maximum, so it shows shape, not magnitude — the number
   * beside it carries the magnitude.
   */
  spark?: number[];
  /** The comparison, pre-formatted: `+0.94%`, `−3 vs yesterday`. */
  delta?: string;
  deltaTone?: StatDeltaTone;
  /** What the delta is measured against: "vs last week". */
  foot?: string;
  className?: string;
}

const DELTA_TONE_CLASS: Record<StatDeltaTone, string> = {
  positive: "text-success-strong",
  negative: "text-destructive-strong",
  neutral: "text-muted-foreground",
};

/**
 * One figure in the Overview's four-column grid (design canvas artboard `1c`).
 *
 * The inset ring — `box-shadow: inset 0 0 0 3px var(--color-background)` — is
 * what gives the canvas its double-border look: the card surface pulled in
 * from its own border by three pixels of the page ground. It is a shadow
 * rather than a second element so the card stays one box for grid purposes.
 */
export function StatCard({
  label,
  value,
  spark,
  delta,
  deltaTone = "neutral",
  foot,
  className,
}: StatCardProps) {
  // A card with neither a delta nor a foot note renders no footer at all —
  // the 14px margin and the rule above it would otherwise leave a bare strip
  // of empty card under the value.
  const hasFoot = Boolean(delta || foot);

  const max = spark ? Math.max(0, ...spark) : 0;
  const sparkBars = spark?.map((sparkValue, index) => ({
    // Position is the identity: these are consecutive buckets of one series,
    // they never reorder, and two of them may hold the same number.
    key: `spark-${index}`,
    // `0 / 0` is NaN, which React writes out as `height: NaN%` — no bar, no
    // error, no clue. A business with no history sends all zeroes on day one.
    percent: max > 0 ? (sparkValue / max) * 100 : 0,
    isLast: index === spark.length - 1,
  }));

  return (
    <div
      data-slot="stat-card"
      className={cn(
        "rounded-[10px] border border-border bg-card px-[18px] py-4 shadow-[inset_0_0_0_3px_var(--color-background)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2.5">
          <span className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
            {label}
          </span>
          <span className="font-mono text-[24px] font-medium whitespace-nowrap text-foreground">
            {value}
          </span>
        </div>

        {sparkBars && sparkBars.length > 0 ? (
          <div
            data-slot="stat-card-spark"
            aria-hidden="true"
            className="flex h-9 flex-none items-end gap-0.5"
          >
            {sparkBars.map((bar) => (
              <span
                key={bar.key}
                style={{ height: `${bar.percent}%` }}
                className={cn(
                  "w-1 rounded-[1px]",
                  // The most recent bucket is the one the value above refers
                  // to, so it carries the full accent and the rest recede.
                  bar.isLast ? "bg-primary" : "bg-primary/30",
                )}
              />
            ))}
          </div>
        ) : null}
      </div>

      {hasFoot ? (
        <div
          data-slot="stat-card-foot"
          className="mt-3.5 flex items-center gap-2 border-t border-border pt-3"
        >
          <Info
            className="size-3.5 flex-none text-muted-3"
            aria-hidden="true"
          />
          {delta ? (
            <span
              className={cn(
                "font-mono text-[11px]",
                DELTA_TONE_CLASS[deltaTone],
              )}
            >
              {delta}
            </span>
          ) : null}
          {foot ? (
            <span className="text-xs text-muted-foreground">{foot}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
