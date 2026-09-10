import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * A row of plain figures inside a `SectionStrip`.
 *
 * `gap-px` over a `bg-border` ground draws the hairline rules between cells
 * without a border on each one, so the grid cannot end up with a doubled rule
 * where two cells meet or a stray one at the edge.
 */
export function FigureGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px bg-border lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One figure: a mono label, the value, and an optional sentence saying what it
 * counts.
 *
 * The sentence is where this feature's traps get told — "matched on the sale's
 * date, not the void's", "debt repayments only" — because a number in a report
 * is only as good as the reader's idea of what went into it, and every one of
 * those is a place two figures on the same screen legitimately disagree.
 */
export function Figure({
  label,
  value,
  foot,
}: {
  label: string;
  value: string;
  foot?: string;
}) {
  return (
    <div className="flex flex-col gap-2 bg-card px-[18px] py-4">
      <span className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="font-mono text-[22px] font-medium text-foreground">
        {value}
      </span>
      {foot ? (
        <span className="text-xs text-pretty text-muted-foreground">
          {foot}
        </span>
      ) : null}
    </div>
  );
}
