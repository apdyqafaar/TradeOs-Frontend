"use client";

import { cn } from "cn";
import { useId } from "react";
import {
  DIGEST_PERIOD_LABELS,
  DIGEST_PERIOD_SHORT_LABELS,
} from "@/features/insights/lib/period";
import {
  DIGEST_PERIOD_PRESETS,
  type DigestPeriodPreset,
} from "@/features/insights/types";

/**
 * The segmented control in the page header: which window the **next** digest
 * covers.
 *
 * It is an input to Generate, not a filter on what is displayed, and the legend
 * says so. `GET /digests/latest` has no period parameter — it answers with the
 * most recent digest whatever window that one covered — so a control that
 * looked like a filter would appear to change the page and change nothing. The
 * digest on screen prints its own resolved period underneath the title; this
 * chooses what the next one will be.
 *
 * **Real radios.** A row of `<button role="radio">` would need arrow-key
 * handling written by hand and gets it subtly wrong; a native radio group has
 * roving focus, arrow keys, and form semantics for free, and the segment is
 * just a styled `<label>`. `appearance-none` plus `sr-only` would remove it
 * from the accessibility tree, so the input keeps its size and is hidden with
 * `absolute opacity-0` instead — focus still lands on it, and
 * `peer-focus-visible` draws the ring on the segment the reader can see.
 */
export function PeriodControl({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: DigestPeriodPreset;
  onChange: (preset: DigestPeriodPreset) => void;
  disabled?: boolean;
  className?: string;
}) {
  const name = useId();

  return (
    <fieldset
      className={cn(
        // Scrolls rather than wraps at 390px, which is what the phone artboard
        // draws; `scrollbar-width: none` would hide the affordance on desktop
        // too, so it keeps the native one.
        "flex max-w-full overflow-x-auto rounded-[10px] border border-border bg-surface-2 p-[3px]",
        disabled && "opacity-50",
        className,
      )}
      disabled={disabled}
    >
      <legend className="sr-only">Period for the next digest</legend>
      {DIGEST_PERIOD_PRESETS.map((preset) => {
        const selected = preset === value;
        return (
          <label
            key={preset}
            className={cn(
              "relative flex h-8 flex-none cursor-pointer items-center whitespace-nowrap rounded-lg px-3 text-[13px]",
              "peer-focus-visible:ring-3",
              selected
                ? "bg-card font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
              disabled && "cursor-not-allowed",
            )}
          >
            <input
              type="radio"
              name={name}
              value={preset}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(preset)}
              className="absolute inset-0 size-full cursor-pointer opacity-0 focus-visible:outline-none"
            />
            {/* Two labels, one element: "Last 7 days" has nowhere to go at
                390px, and "7 days" is thin beside "This year" on a 1280 header.
                The accessible name is the long one at every width, because a
                screen reader has no such constraint. */}
            <span className="sr-only">{DIGEST_PERIOD_LABELS[preset]}</span>
            <span aria-hidden className="lg:hidden">
              {DIGEST_PERIOD_SHORT_LABELS[preset]}
            </span>
            <span aria-hidden className="hidden lg:inline">
              {DIGEST_PERIOD_LABELS[preset]}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * The two dates a `custom` period needs, as bare `yyyy-MM-dd` — which is what
 * `POST /digests/run` takes and what the shop's own calendar day is.
 *
 * **A typo here is free.** The backend resolves the window *before* it spends
 * the allowance, so `INVALID_DATE`, `INVALID_PERIOD` and `PERIOD_TOO_LONG` come
 * back as 400s with the quota untouched — which is why this control validates
 * nothing itself and lets the server say what is wrong. The note under it says
 * so, because "will this cost me one of my two runs?" is the question that
 * stops an owner from trying.
 */
export function CustomRangeFields({
  from,
  to,
  onChange,
  disabled = false,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  disabled?: boolean;
}) {
  const fromId = useId();
  const toId = useId();

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor={fromId}
          className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]"
        >
          From
        </label>
        <input
          id={fromId}
          type="date"
          value={from}
          max={to || undefined}
          disabled={disabled}
          onChange={(event) => onChange({ from: event.target.value, to })}
          className="h-8 rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor={toId}
          className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]"
        >
          To
        </label>
        <input
          id={toId}
          type="date"
          value={to}
          min={from || undefined}
          disabled={disabled}
          onChange={(event) => onChange({ from, to: event.target.value })}
          className="h-8 rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <p className="font-mono text-[11px] text-muted-2">
        A date the server refuses costs no run.
      </p>
    </div>
  );
}
