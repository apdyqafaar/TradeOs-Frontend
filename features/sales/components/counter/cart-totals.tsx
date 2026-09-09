"use client";

import { cn } from "cn";
import { useId } from "react";
import { NumericCell } from "@/features/sales/components/counter/numeric-cell";
import type { CartTotals as Totals } from "@/features/sales/store/cart";
import { useCartStore } from "@/features/sales/store/cart";
import { formatMoney } from "@/lib/format/money";

export interface CartTotalsProps {
  /** Straight from `cartTotals(...)`. Nothing here recomputes any of it. */
  totals: Totals;
  /** The business's MAIN currency code — all three figures are in it. */
  currency: string;
  /** The order-level discount's refusal, keyed `errors.discount` by the API. */
  error?: string;
  disabled?: boolean;
}

/**
 * Subtotal, sale discount and the 28px total — the middle band of artboard
 * `2a`'s cart column.
 *
 * **The sale discount is editable here, and the canvas does not draw it that
 * way.** `2a` prints `Sale discount   USD 5.00` as static text, with no control
 * anywhere on the screen that could have produced the number — yet
 * `POST /sales` takes an order-level `discount` and the counter is the only
 * place a shopkeeper could ever set one. It is rendered as the canvas draws it
 * and typed into in place: a box that looks like the figure it replaces, rather
 * than a labelled field that would push the total off the fold.
 *
 * Every number arrives already computed. `subtotal` and `total` are the store's
 * transcription of `sale.service.ts:173-174`, which rounds **per line and then
 * again on the sum** — summing raw products and rounding once is a cent out
 * whenever two lines land on a half (`docs/findings/slice3-sales-data.md`).
 */
export function CartTotals({
  totals,
  currency,
  error,
  disabled,
}: CartTotalsProps) {
  const uid = useId();
  const errorId = `${uid}-error`;
  const setOrderDiscount = useCartStore((state) => state.setOrderDiscount);

  return (
    <div className="flex flex-col gap-2.5 border-border border-t px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted-foreground">Subtotal</span>
        <span className="font-mono text-[13px] text-foreground">
          {formatMoney(totals.subtotal, currency)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted-foreground">Sale discount</span>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-[6px] border px-1.5 py-0.5 transition-colors",
            error
              ? "border-destructive/50"
              : "border-transparent hover:border-border focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          )}
        >
          <span className="font-mono text-[13px] text-muted-2">{currency}</span>
          <NumericCell
            // An **amount**, not a percentage — `discount` on this endpoint is
            // money-typed at both levels (`docs/contracts/sales.md` §6).
            label={`Sale discount in ${currency}`}
            value={totals.orderDiscount}
            decimals={2}
            disabled={disabled}
            invalid={error !== undefined}
            describedBy={error ? errorId : undefined}
            onCommit={(value) => {
              // Clearing the box is not a request for a zero discount; the
              // blur restores what the cart holds. Type `0` to remove one.
              if (value !== null) setOrderDiscount(value);
            }}
            className="w-[76px] text-right text-[13px]"
          />
        </span>
      </div>

      {error ? (
        <p id={errorId} className="text-[12px] text-destructive-strong">
          {error}
        </p>
      ) : null}

      <div className="flex items-baseline justify-between gap-3 border-border border-t pt-2.5">
        <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
          Total
        </span>
        <span className="font-medium font-mono text-[28px] text-foreground">
          {formatMoney(totals.total, currency)}
        </span>
      </div>
    </div>
  );
}
