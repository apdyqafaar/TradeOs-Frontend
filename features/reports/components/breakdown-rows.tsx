import { cn } from "cn";

export interface BreakdownRow {
  /**
   * The row's id — optional on purpose.
   *
   * A ranked report's `key` comes out of a `$group`/`$lookup` stage, and a
   * `$project` emits **no key at all** when the stage it names produced
   * nothing (`docs/contracts/reports.md` §3.10 shows the same hole on
   * `customers/top`'s `label`). Typing it as required would only move the
   * `undefined` somewhere it is not being watched for.
   */
  id?: string;
  /** Already resolved by the caller, including its fallback for a missing name. */
  label: string;
  /** 0..1, as it comes off the wire. Widths and the percentage both read from it. */
  share: number;
  /** Pre-formatted. Only the caller knows whether this is money, a count or a weight. */
  value: string;
  /** The middle column: a quantity, a sale count — pre-formatted, optional. */
  meta?: string;
}

interface BreakdownRowsProps {
  rows: BreakdownRow[];
  /** Names the value column for assistive technology: "Revenue", "Outstanding". */
  valueLabel: string;
  className?: string;
}

/**
 * The ranked list of artboard `2i`
 * (`docs/design/TradeOs-UI.dc.html:1165-1176`): a name, a share bar, an
 * optional middle figure and the value.
 *
 * **The bar is `share`, not `value / max`.** `share` is what the API computed
 * (`value ÷ the sum of the rows returned`, `shapes.ts:55-62`), so the bars add
 * up to the full track and a reader can see a leader taking half of a top ten.
 * Scaling to the largest row instead would always paint the first row full
 * width, which says nothing.
 *
 * What `share` is a share **of** is the caller's to state, and it matters: it
 * is computed after `$limit`, so on a top-10 it is "of the ten shown", never
 * of the period's revenue (§2.1). Every caller passes that sentence to the
 * panel's `info` slot.
 */
export function BreakdownRows({
  rows,
  valueLabel,
  className,
}: BreakdownRowsProps) {
  return (
    <ul className={cn("flex flex-col", className)}>
      {rows.map((row, index) => (
        <li
          // Position is the fallback identity, and a sound one here: these
          // rows are one server-sorted ranking that is replaced wholesale on
          // every refetch, never reordered in place.
          key={row.id ?? `row-${index}`}
          className="grid h-[46px] grid-cols-[1.4fr_2fr_1fr] items-center gap-3 border-b border-border/60 px-[18px] last:border-b-0 sm:grid-cols-[1.4fr_2fr_0.8fr_1fr]"
        >
          <span
            className="truncate text-[13px] text-foreground"
            title={row.label}
          >
            {row.label}
          </span>

          <span
            className="block h-2.5 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${(row.share * 100).toFixed(1)}% of the rows shown`}
          >
            <span
              className="block h-2.5 rounded-full bg-chart-1"
              style={{
                // Clamped, not trusted: `share` is a ratio of sums the server
                // computed, and a negative row (a loss-making product) would
                // otherwise produce `width: -12%`, which the browser drops
                // silently, leaving a full-width bar on the worst row.
                width: `${Math.min(100, Math.max(0, row.share * 100))}%`,
              }}
            />
          </span>

          <span className="hidden text-right font-mono text-xs text-muted-foreground sm:block">
            {row.meta ?? ""}
          </span>

          <span className="text-right font-mono text-[13px] text-foreground">
            <span className="sr-only">{valueLabel}: </span>
            {row.value}
          </span>
        </li>
      ))}
    </ul>
  );
}
