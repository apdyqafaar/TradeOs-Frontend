import { cn } from "cn";

export interface ProgressMeterProps {
  /** 0..100. Clamped here, because a bar wider than its track is a layout bug. */
  value: number;
  /** Track height in pixels. The canvas uses 6 on cards and 8 on headers. */
  height?: number;
  /** Names what the bar is measuring for a screen reader. */
  label: string;
  className?: string;
}

/**
 * The progress bar — artboard `2l`, on cards, the detail header, the update
 * composer and the public page.
 *
 * `role="progressbar"` with the three aria values rather than a bare pair of
 * divs: this is the only place a project's progress is expressed visually, and
 * on the public page it is the main thing a client came to see. The percentage
 * is also always rendered as text beside it by every caller, so nobody depends
 * on the bar alone.
 *
 * A Server Component. It has no state and the public page must not pay for a
 * client bundle to draw a rectangle.
 *
 * The value is clamped and rounded because the wire type is an integer 0..100
 * but nothing stops a future caller passing a computed average.
 */
export function ProgressMeter({
  value,
  height = 6,
  label,
  className,
}: ProgressMeterProps) {
  const percent = Math.round(Math.min(100, Math.max(0, value)));

  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "block flex-1 overflow-hidden rounded-full bg-surface-2",
        className,
      )}
      style={{ height }}
    >
      <span
        className="block rounded-full bg-primary transition-[width] duration-300"
        style={{ height, width: `${percent}%` }}
      />
    </span>
  );
}
