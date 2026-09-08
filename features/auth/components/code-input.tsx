"use client";

import { cn } from "cn";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { useRef } from "react";

/** Everything that is not 0-9. Codes are numeric; the API's are six digits. */
const NOT_A_DIGIT = /\D/g;

/**
 * The row of single-character boxes artboard `1f`
 * (`docs/design/TradeOs-UI.dc.html:2740`) draws for the 2FA code: six equal
 * boxes, 56px tall, 10px radius, centred 22px mono.
 *
 * The value is one string owned by the parent and each box renders
 * `value[index]`, which is what makes paste, autofill and auto-submit a single
 * code path instead of six pieces of per-box state to reconcile.
 *
 * That representation cannot express a gap — "1", box 2 empty, "3" is not a
 * string — so the component maintains a no-gaps invariant instead of trying to
 * store one: focusing a box beyond the first empty one redirects to the first
 * empty one, and deleting a digit closes up behind it the way a single text
 * field would. Without the redirect, clicking box 4 of an empty code and
 * typing would put the digit in box 1 and move the caret somewhere the user
 * did not ask for.
 */
export function CodeInput({
  length,
  value,
  onChange,
  label,
  disabled = false,
  invalid = false,
  describedBy,
}: {
  length: number;
  /** The code so far. Never longer than `length`, never sparse. */
  value: string;
  onChange: (value: string) => void;
  /** Names the group for a screen reader; rendered as a visually hidden legend. */
  label: string;
  disabled?: boolean;
  /** Paints every box with the destructive border after a rejected code. */
  invalid?: boolean;
  /** Id of the element describing the group — the error text, usually. */
  describedBy?: string;
}) {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  /**
   * True only while this component is moving focus itself.
   *
   * `focus()` dispatches the focus event synchronously, before React has
   * applied the `onChange` that preceded it, so the `onFocus` handler below
   * would read the previous `value` and bounce focus back to the box the user
   * just filled. The redirect exists for a click or a Tab, not for this.
   */
  const movingFocus = useRef(false);

  const focusBox = (index: number) => {
    const box = boxes.current[Math.min(Math.max(index, 0), length - 1)];
    movingFocus.current = true;
    box?.focus();
    // Selecting means the next keystroke replaces the digit. `maxLength={1}`
    // otherwise makes a filled box inert: the browser drops the new character
    // rather than overwriting, and the user has to delete before retyping.
    box?.select();
    movingFocus.current = false;
  };

  /**
   * Writes `raw`'s digits starting at `index`. One path for a typed character,
   * a pasted code and an SMS/authenticator autofill, which differ only in how
   * many digits arrive at once.
   */
  const write = (rawIndex: number, raw: string) => {
    // The invariant, enforced at the write rather than only at the caret: a
    // digit typed past the end of the code lands at the end of it. The focus
    // redirect below cannot cover this on its own, because clearing the value
    // from outside (a rejected code) fires no focus event.
    const index = Math.min(rawIndex, value.length);
    const digits = raw.replace(NOT_A_DIGIT, "");

    if (digits.length === 0) {
      // The box was cleared. Close the gap rather than leaving one, so the
      // string keeps meaning "the first N boxes, in order".
      onChange(value.slice(0, index) + value.slice(index + 1));
      return;
    }

    onChange(
      (
        value.slice(0, index) +
        digits +
        value.slice(index + digits.length)
      ).slice(0, length),
    );
    focusBox(index + digits.length);
  };

  const handlePaste = (
    index: number,
    event: ClipboardEvent<HTMLInputElement>,
  ) => {
    const pasted = event.clipboardData.getData("text");
    if (!pasted) return;
    // A full-length paste is the whole code however it was aimed; a short one
    // is an insert at the box the user is standing in.
    event.preventDefault();
    const digits = pasted.replace(NOT_A_DIGIT, "");
    write(digits.length >= length ? 0 : index, digits);
  };

  const handleKeyDown = (
    index: number,
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Backspace" && !value[index]) {
      // No character to delete here, so the browser fires no `change` at all.
      // One press removes one digit: step back and take that one.
      event.preventDefault();
      if (index === 0) return;
      onChange(value.slice(0, index - 1) + value.slice(index));
      focusBox(index - 1);
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusBox(index - 1);
      return;
    }
    if (event.key === "ArrowRight" && index < length - 1) {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  return (
    <fieldset disabled={disabled} className="min-w-0 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex gap-2.5">
        {Array.from({ length }, (_, index) => `digit-${index}`).map(
          (id, index) => (
            <input
              key={id}
              ref={(element) => {
                boxes.current[index] = element;
              }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              // Only the first box carries it: iOS offers the SMS code once per
              // form, and repeating the token on all six makes it offer six
              // times. A code that lands whole is spread by `write`.
              autoComplete={index === 0 ? "one-time-code" : "off"}
              value={value[index] ?? ""}
              aria-label={`Digit ${index + 1} of ${length}`}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(event) => write(index, event.target.value)}
              onPaste={(event) => handlePaste(index, event)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              onFocus={(event) => {
                if (movingFocus.current) return;
                // Keeps the no-gaps invariant: you cannot start typing in the
                // middle of an unfilled code.
                if (index > value.length) {
                  focusBox(value.length);
                  return;
                }
                event.currentTarget.select();
              }}
              className={cn(
                "h-14 min-w-0 flex-1 rounded-[10px] border border-border bg-card text-center font-mono text-[22px] outline-none transition-[color,box-shadow]",
                "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                "disabled:cursor-not-allowed disabled:opacity-50",
                invalid &&
                  "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30",
              )}
            />
          ),
        )}
      </div>
    </fieldset>
  );
}
