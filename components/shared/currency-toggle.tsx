"use client";

import { cn } from "cn";
import { useId } from "react";
import { useCurrencyConfig } from "@/features/organization/hooks/use-currency-config";

/**
 * The rate, unpadded, up to six decimals — the same shape as `RATE` in
 * `lib/format/money.ts`, which is module-private there.
 *
 * `formatMoney` is deliberately not used: it is fixed at two decimals, so the
 * other direction of the same pair (main USD, exchange KES, rate 0.0077) would
 * print `0.01` and the hint would state a rate nobody trades at.
 */
const RATE = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
});

export interface CurrencyToggleProps {
  /**
   * The selected ISO code. Seed it with `mainCurrency` from
   * `useCurrencyConfig` — this control never owns the choice, and a value
   * matching neither option leaves both unchecked rather than guessing.
   */
  value: string;
  onChange: (currency: string) => void;
  /**
   * Names the group for a screen reader, and disambiguates two toggles on one
   * screen. Never rendered visibly: artboards `2a` and `2g` both draw the pair
   * with no visible caption.
   */
  label?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The segmented `USD | KES` control with its rate hint — artboards `2a`
 * (line 217) and `2g` (line 874), which draw it identically.
 *
 * **It renders nothing when the business has no second currency**, which is
 * the whole reason `hasExchange` exists: nothing in either repo forbids
 * setting both codes to the same one, and the alternative is a `USD | USD`
 * control above a line reading `1 USD = 1 USD`. `hasExchange` is also false
 * while the config is loading, so there is no flash of a one-sided toggle.
 *
 * The hint reads `1 <exchange> = <rate> <main>`. `exchangeRate` is units of
 * MAIN per one unit of EXCHANGE — see `toMain` in `Backend/src/lib/money.ts`
 * and the note on `CurrencyContext.exchangeRate` — so a Kenyan shop keeping
 * books in KES and taking dollars at the counter (main KES, exchange USD,
 * rate 130) reads `1 USD = 130 KES`. The inverse is the sentence that comes
 * out of the mouth first, and it is how this repo once printed KES 0.77 for a
 * KES 13,000 tender.
 *
 * Real radios rather than buttons with `aria-pressed`: choosing one of two
 * codes is a single-select, and native radios bring the whole keyboard
 * contract — one tab stop for the group, arrow keys between the options, a
 * name each — without a roving-tabindex implementation to get wrong.
 */
export function CurrencyToggle({
  value,
  onChange,
  label = "Currency",
  disabled,
  className,
}: CurrencyToggleProps) {
  const name = useId();
  const { mainCurrency, exchangeCurrency, exchangeRate, hasExchange } =
    useCurrencyConfig();

  if (!hasExchange) return null;

  // Main first, because it is what every total on the screen is already
  // denominated in and what the caller seeds `value` with. Artboard `2a` draws
  // the first segment selected.
  const options = [mainCurrency, exchangeCurrency];

  // One string, one text node: split across three the sentence could not be
  // asserted whole, and the direction is exactly what needs a test.
  const hint = `1 ${exchangeCurrency} = ${RATE.format(exchangeRate)} ${mainCurrency}`;

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {/* #E8E6DE track, #FBFAF7 selected pill, 10px outer / 8px inner radius —
          `--surface-2` is documented in `app/globals.css` as the segmented
          control track. Artboard `2g` draws the track one step lighter
          (`--muted`); the token's own comment settles it. */}
      <fieldset
        disabled={disabled}
        className="flex rounded-[10px] border border-border bg-surface-2 p-[3px]"
      >
        <legend className="sr-only">{label}</legend>
        {options.map((code) => {
          const selected = code === value;
          return (
            <label
              key={code}
              className={cn(
                "flex h-[38px] cursor-pointer items-center rounded-[8px] px-[18px] font-mono text-[13px] transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                selected
                  ? "bg-card font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="radio"
                name={name}
                value={code}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(code)}
                className="sr-only"
              />
              {code}
            </label>
          );
        })}
      </fieldset>

      <span className="font-mono text-[12px] text-muted-2">{hint}</span>
    </div>
  );
}
