"use client";

import { cn } from "cn";
import { useState } from "react";

/**
 * How many decimals a cell holds: money is 2, a quantity is 3.
 *
 * Both bounds are the API's, not a preference — `moneySchema` refuses a third
 * decimal and `quantitySchema` a fourth (`../Backend/src/lib/money.ts:34-47`),
 * so a keystroke that would make the value unsendable never reaches state.
 */
export type CellDecimals = 2 | 3;

const PATTERNS: Record<CellDecimals, RegExp> = {
  2: /^\d*(\.\d{0,2})?$/,
  3: /^\d*(\.\d{0,3})?$/,
};

/** `"12."` → 12; `""` and `"."` → null. `Number("")` is 0, which is not empty. */
function parse(draft: string): number | null {
  if (draft === "" || draft === ".") return null;
  const value = Number(draft);
  return Number.isFinite(value) ? value : null;
}

/**
 * Money settles at two decimals — the canvas draws every amount that way.
 * A quantity does not: `1.000 kg` is noise, and `String(1.5)` is `"1.5"`.
 */
function toDraft(value: number, decimals: CellDecimals): string {
  return decimals === 2 ? value.toFixed(2) : String(value);
}

export interface NumericCellProps {
  /** The accessible name. Name the product too — a cart holds four "Disc" boxes. */
  label: string;
  value: number;
  decimals: CellDecimals;
  /**
   * `null` for an emptied box. The caller decides what that means: a cleared
   * discount is zero, a cleared quantity is nothing the store may hold, since
   * `quantitySchema` refuses `0` outright.
   */
  onCommit: (value: number | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  /**
   * Id of the element carrying the refusal for this cell. The message is
   * already beside the box for anyone who can see it; this is what puts it in
   * front of anyone who cannot.
   */
  describedBy?: string;
  id?: string;
  className?: string;
}

/**
 * The bare numeric input inside the counter's 38px cells — the quantity between
 * the stepper buttons, and the `Unit` and `Disc` boxes of artboard `2a`.
 *
 * **It is not `type="number"`**, for the reason `components/shared/money-input.tsx`
 * spells out and this repo has now hit three times: a number input reports `""`
 * for anything the browser considers invalid, and `"12."` is invalid — so the
 * amount vanishes for the keystroke between `12` and `12.5`. It also accepts
 * `1e4`, and a scroll wheel over a focused field silently re-prices a line.
 *
 * A keystroke that fails the pattern is **dropped**, never rewritten: rewriting
 * moves the caret, and clamping `"12."` to `"12"` deletes the point on the
 * frame it was typed.
 *
 * The box holds text while the store holds a number, so the two are kept in
 * step by adjusting state **during render** rather than in an effect — React's
 * own documented pattern, and the only one that does not re-render the field
 * twice per keystroke. Comparing the *parsed* number rather than the string is
 * what lets `"12."` stay on screen while the store holds `12`; it also means a
 * value changed from outside (a re-scan merging into this line, a cleared cart)
 * is adopted immediately.
 *
 * This is deliberately not `MoneyInput`. That component is the 48px labelled
 * field with its own hints, its `max` refusal and its converted second line —
 * the payment block's control, not a 38px cell in a table of them.
 */
export function NumericCell({
  label,
  value,
  decimals,
  onCommit,
  disabled,
  invalid,
  describedBy,
  id,
  className,
}: NumericCellProps) {
  const [draft, setDraft] = useState(() => toDraft(value, decimals));
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue) {
    setLastValue(value);
    if (parse(draft) !== value) setDraft(toDraft(value, decimals));
  }

  return (
    <input
      id={id}
      type="text"
      // The decimal keypad, without `type="number"`'s spinner or its
      // scroll-wheel edit.
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      disabled={disabled}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        if (!PATTERNS[decimals].test(next)) return;
        setDraft(next);
        onCommit(parse(next));
      }}
      // Settling on the way out rather than on each keystroke is what lets
      // `"12."` and `".5"` be typed at all. A draft the caller refused to
      // commit is discarded here, so the box can never disagree with the cart.
      onBlur={() => setDraft(toDraft(value, decimals))}
      className={cn(
        "min-w-0 bg-transparent font-mono text-foreground outline-none disabled:opacity-50",
        invalid && "text-destructive-strong",
        className,
      )}
    />
  );
}
