import { round2 } from "@/features/sales/store/cart";
import type { SalePaymentStatus } from "@/features/sales/types";

/**
 * What a tender does to a cart total — the four numbers the counter prints
 * before the sale exists.
 *
 * **This is the one piece of money arithmetic the cart store does not own.**
 * `cartTotals` stops at `total`; everything past it depends on the currency the
 * customer is paying in, which is server state the store deliberately refuses
 * to hold (`features/sales/store/cart.ts`, "the cart holds no currency"). So
 * the derivation lives here, in the counter that already has both halves.
 *
 * Every line below is a transcription of
 * `../Backend/src/services/sale.service.ts:177-180` and the two converters it
 * calls (`toMain`/`fromMain`, `../Backend/src/lib/money.ts:28,31`), read
 * directly rather than paraphrased:
 *
 * ```ts
 * const tenderedMain   = toMain(input.payment.amountTendered, rate);
 * const amountPaidMain = Math.min(tenderedMain, total);
 * const change         = Math.max(0, round2(input.payment.amountTendered - fromMain(total, rate)));
 * const amountDue      = round2(total - amountPaidMain);
 * ```
 *
 * `round2` comes from the store rather than being written again: it is the
 * server's formula including its `Number.EPSILON` and its asymmetry below zero,
 * and a second copy is a second thing to keep in step
 * (`docs/findings/slice3-sales-data.md`).
 *
 * Getting this wrong is not a cosmetic bug. `amountDue > 0` is what turns a
 * sale into a debt, so a cent of disagreement with the server is a credit block
 * that does not appear before a 422 that says it should have.
 */
export interface TenderOutcome {
  /** In the business's MAIN currency: `min(toMain(tendered, rate), total)`. */
  amountPaidMain: number;
  /** In MAIN currency. Above zero means this sale opens a debt. */
  amountDue: number;
  /**
   * In the **tendered** currency, not in main — the customer is handed back
   * what they paid with (`docs/contracts/sales.md` §6, trap 5).
   */
  change: number;
  /** The server's own ternary, in its own order: `paid` wins a zero total. */
  paymentStatus: SalePaymentStatus;
}

export interface TenderInput {
  /** `cartTotals(...).total`, in MAIN currency. */
  total: number;
  /** What the customer handed over, in the tendered currency. */
  amountTendered: number;
  /** Units of main per one unit of the tendered currency — `resolveRate`. */
  rate: number;
}

/**
 * The tendered currency's rate, or `null` when the API would refuse it.
 *
 * `resolveRateFrom` (`sale.service.ts:52-61`) accepts exactly two codes and
 * throws a 422 keyed `payment.currency` for anything else. Returning `null`
 * rather than falling back to `1` is the point: a silent fallback would price a
 * KES tender as if it were dollars and only the receipt would say so.
 *
 * A non-positive or non-finite rate is `null` too. It cannot arrive from
 * `useCurrencyConfig` (`hasExchange` already excludes it) but it is what
 * divides in `change`, and `Infinity` on a counter screen is not a state worth
 * being one bad config away from.
 */
export function resolveRate(
  currency: string,
  config: {
    mainCurrency: string;
    exchangeCurrency: string;
    exchangeRate: number;
  },
): number | null {
  if (currency !== "" && currency === config.mainCurrency) return 1;
  if (currency !== "" && currency === config.exchangeCurrency) {
    return Number.isFinite(config.exchangeRate) && config.exchangeRate > 0
      ? config.exchangeRate
      : null;
  }
  return null;
}

export function tenderOutcome({
  total,
  amountTendered,
  rate,
}: TenderInput): TenderOutcome {
  const tenderedMain = round2(amountTendered * rate);
  // `Math.min`, not a re-round: both operands are already 2 dp, and rounding
  // again here is a third rounding the server does not do.
  const amountPaidMain = Math.min(tenderedMain, total);
  const change = Math.max(0, round2(amountTendered - round2(total / rate)));
  const amountDue = round2(total - amountPaidMain);

  return {
    amountPaidMain,
    amountDue,
    change,
    // Order matters and is the server's: a zero total is `paid`, even though
    // `amountDue === total` is also true of it.
    paymentStatus:
      amountDue === 0 ? "paid" : amountDue === total ? "credit" : "partial",
  };
}
