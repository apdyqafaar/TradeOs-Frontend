"use client";

import { cn } from "cn";
import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { formatExchange, formatMoney } from "@/lib/format/money";

/**
 * Everything the box is allowed to hold: digits, then at most two decimals.
 *
 * A keystroke that does not match is dropped rather than corrected, which is
 * what lets `"12."` exist — it matches with nothing after the point — while
 * `"12.345"`, `"-5"` and `"1e4"` never reach state at all. Rewriting the text
 * instead would move the caret and destroy a number mid-typing, and clamping a
 * partial `"12."` to `"12"` would delete the point the moment it was typed.
 */
const DRAFT = /^\d*(\.\d{0,2})?$/;

/** `"12."` → 12, `""` and `"."` → null. `Number("")` is 0, which is not empty. */
function parseAmount(draft: string): number | null {
  if (draft === "" || draft === ".") return null;
  const value = Number(draft);
  return Number.isFinite(value) ? value : null;
}

/** Artboards `2a` and `2g` both draw the field settled at two decimals. */
function toDraft(value: number | null): string {
  return value === null ? "" : value.toFixed(2);
}

export interface MoneyInputProps {
  /** Visible, and tied to the input by `htmlFor` — "Amount tendered", "Amount". */
  label: string;
  /**
   * The amount, or `null` for an empty box. **A number, never a string**, so
   * no caller parses one: every screen taking money would otherwise write its
   * own `Number()` and its own answer for `""`.
   */
  value: number | null;
  onChange: (value: number | null) => void;
  /** ISO code the typed amount is in. Renders in the hints, never in the box. */
  currency: string;
  /**
   * The books' currency. When it differs from `currency`, the converted second
   * line appears — artboard `2a`'s exchange tender.
   */
  mainCurrency?: string;
  /** Units of `mainCurrency` per one unit of `currency`. */
  exchangeRate?: number;
  /** Renders artboard `2g`'s `max USD 167.75` hint and flags anything above it. */
  max?: number;
  /**
   * Text for the fill-to-`max` action — artboard `2g`'s "Pay in full". The
   * words are the caller's so this file never learns what a debt is; it does
   * nothing without `max`, which is the amount it fills.
   */
  fillLabel?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * The amount field of artboards `2a` (line 217) and `2g` (line 874): 48px
 * tall, an 18px mono value, an optional fill action beside the label and up to
 * two hint lines under it.
 *
 * **It is not `type="number"`.** A number input hands back `""` for anything
 * the browser considers invalid, so `"12."` arrives as an empty string and the
 * amount vanishes for one keystroke; it also accepts `1e4` and a scroll wheel
 * over a focused field silently changes a price. The value is parsed here
 * instead, once, against `DRAFT`.
 *
 * The box holds text while the caller holds a number, so the two are kept in
 * step by adjusting state during render rather than in an effect — React's own
 * pattern for a prop-derived value, and the only one that does not re-render
 * the field twice per keystroke. The comparison is on the *parsed* number, not
 * the string, which is what lets `"12."` stay on screen while the caller holds
 * `12`. A caller that overrides what was typed — clamping to `max`, resetting
 * after a save — changes `value` to something the draft does not parse to, and
 * the box adopts it.
 *
 * An amount over `max` is still reported. The caller owns the refusal (the API
 * owns the real one), and silently clamping would tell a shopkeeper their
 * 200 was accepted as 167.75.
 */
export function MoneyInput({
  label,
  value,
  onChange,
  currency,
  mainCurrency,
  exchangeRate,
  max,
  fillLabel,
  id,
  name,
  disabled,
  placeholder,
  className,
}: MoneyInputProps) {
  const uid = useId();
  const inputId = id ?? `${uid}-amount`;
  const currencyNoteId = `${uid}-currency`;
  const maxId = `${uid}-max`;
  const convertedId = `${uid}-converted`;

  const [draft, setDraft] = useState(() => toDraft(value));
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue) {
    setLastValue(value);
    if (parseAmount(draft) !== value) setDraft(toDraft(value));
  }

  const over = max !== undefined && value !== null && value > max;

  /*
   * `formatExchange` returns both the tendered and the converted string; only
   * the second is rendered, because the first is the box itself. It
   * MULTIPLIES, matching `toMain` in `Backend/src/lib/money.ts` — reproducing
   * the arithmetic here is how a receipt and a charge end up disagreeing.
   */
  const converted =
    mainCurrency !== undefined && mainCurrency !== currency && value !== null
      ? formatExchange(value, currency, exchangeRate ?? 0, mainCurrency)
          .converted
      : null;

  const describedBy = [
    currencyNoteId,
    max !== undefined ? maxId : null,
    converted ? convertedId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={inputId} className="text-[13px]">
          {label}
        </Label>
        {/* The canvas draws this as bare terracotta text, not a button. It is a
            button anyway: it changes the amount, so it has to be reachable by
            tab and operable by Enter. */}
        {fillLabel !== undefined && max !== undefined ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(max)}
            className="rounded-[6px] font-medium text-[12px] text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {fillLabel}
          </button>
        ) : null}
      </div>

      <input
        id={inputId}
        name={name}
        type="text"
        // The keypad with a decimal point, without `type="number"`'s spinner,
        // its scroll-wheel edit or its empty-string-for-invalid behaviour.
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={over ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          const next = event.target.value;
          if (!DRAFT.test(next)) return;
          setDraft(next);
          onChange(parseAmount(next));
        }}
        // Settling to two decimals on the way out rather than on each
        // keystroke is what lets `"12."` and `".5"` be typed at all.
        onBlur={() => setDraft(toDraft(parseAmount(draft)))}
        className="h-12 w-full rounded-[10px] border border-border bg-background px-3 font-mono text-[18px] text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
      />

      {/* The canvas puts no code inside the box — the toggle above it says
          which currency — so the only thing that would tell a screen-reader
          user is this. `sr-only` is absolutely positioned, so it is not a flex
          item and adds no gap. */}
      <span id={currencyNoteId} className="sr-only">
        {`Amount in ${currency}`}
      </span>

      {max !== undefined ? (
        <p
          id={maxId}
          className={cn(
            "font-mono text-[11px]",
            over ? "text-destructive" : "text-muted-2",
          )}
        >
          {/* Colour alone would not carry the refusal to a screen reader or to
              a colour-blind reader, so the words change too. */}
          {over
            ? `over the max of ${formatMoney(max, currency)}`
            : `max ${formatMoney(max, currency)}`}
        </p>
      ) : null}

      {converted ? (
        <p
          id={convertedId}
          className="font-mono text-[12px] text-muted-foreground"
        >
          {converted}
        </p>
      ) : null}
    </div>
  );
}
