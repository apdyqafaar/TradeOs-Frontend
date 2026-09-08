/**
 * Money and quantity formatting (brief §8.1).
 *
 * Currency **code**, never a symbol: the market runs several currencies whose
 * symbols collide ($ is USD, CAD and a dozen others; Sh is KES, TZS, UGS), and
 * a receipt that says the wrong one is a dispute. `Intl.NumberFormat` is used
 * only for grouping and decimals — its own `style: "currency"` picks the
 * symbol and puts it where the locale wants, which is what this avoids.
 */

/**
 * Fixed to en-US, not the visitor's locale. Amounts appear next to the API's
 * own numbers on receipts and reports, and a browser set to de-DE would render
 * `1.250,00` beside a backend that emitted `1250.00`.
 */
const MONEY = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const QUANTITY = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  // The API stores quantities to 3 dp; trailing zeros are trimmed, so 0.250
  // reads as 0.25 and a whole number as itself.
  maximumFractionDigits: 3,
});

/** Rates can be whole (130) or fractional (0.0077); show what is there, no padding. */
const RATE = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
});

/** `formatMoney(1250, "USD")` → `"USD 1,250.00"`. Always two decimals. */
export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${MONEY.format(Number.isFinite(amount) ? amount : 0)}`;
}

/** `formatQuantity(1.5, "kg")` → `"1.5 kg"`; `formatQuantity(2)` → `"2"`. */
export function formatQuantity(value: number, unit?: string): string {
  const formatted = QUANTITY.format(Number.isFinite(value) ? value : 0);
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * A payment tendered in the exchange currency, as the brief's two lines:
 * `KES 5,000.00` with a muted `≈ USD 38.46 @ 130` underneath.
 *
 * Returned as two strings rather than one, because they are styled
 * differently — the conversion is muted and one step down in size — and
 * splitting a joined string in the component would be worse.
 *
 * `converted` is `null` when the rate is unusable, which is the only case
 * where dividing would produce Infinity or NaN on a receipt.
 */
export interface ExchangeDisplay {
  tendered: string;
  converted: string | null;
}

export function formatExchange(
  amount: number,
  currency: string,
  rate: number,
  mainCurrency: string,
): ExchangeDisplay {
  const tendered = formatMoney(amount, currency);
  if (!Number.isFinite(rate) || rate <= 0) return { tendered, converted: null };

  // The rate is "how many exchange units to one main unit" (USD main, KES
  // exchange at 130), so the tendered amount divides by it.
  return {
    tendered,
    converted: `≈ ${formatMoney(amount / rate, mainCurrency)} @ ${RATE.format(rate)}`,
  };
}
