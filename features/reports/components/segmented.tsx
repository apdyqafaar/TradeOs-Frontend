"use client";

import { cn } from "cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  /** Names the choice to a screen reader; never printed. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * The small segmented control artboard `2i` puts in a panel header
 * (`docs/design/TradeOs-UI.dc.html:1140-1144`) — `Day · Week · Month`,
 * `Revenue · Quantity`, `Spend · Balance`.
 *
 * A `fieldset` with a visually hidden `legend`, not a `div` with
 * `role="group"`: the buttons are one choice and the legend is what names that
 * choice without printing a label the canvas does not draw. `aria-pressed`
 * carries the selection, matching the Overview's trend control so the two
 * screens behave identically under a screen reader.
 *
 * Every option here changes a **query parameter** — the request is refetched
 * under a new key. None of them re-slices data already on screen, which is
 * what keeps a toggle from quietly showing a total that no longer matches its
 * label.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <fieldset
      className={cn(
        "flex rounded-[9px] border border-border bg-surface-2 p-0.5",
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-[26px] items-center rounded-[7px] px-3 text-xs transition-colors",
            option.value === value
              ? "bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(31,30,29,0.06)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
