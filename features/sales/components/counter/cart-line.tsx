"use client";

import { cn } from "cn";
import { Minus, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useId } from "react";
import { NumericCell } from "@/features/sales/components/counter/numeric-cell";
import {
  type CartLine,
  lineTotal,
  useCartStore,
} from "@/features/sales/store/cart";
import { formatMoney } from "@/lib/format/money";

/**
 * `round3` from `../Backend/src/lib/money.ts:21`, and the same transcription
 * `features/sales/store/cart.ts` keeps module-private for merging a re-scan.
 *
 * The stepper needs it for the same reason that merge does: `0.1 + 1` is
 * `1.1000000000000001` in binary floats, which `isQuantity` refuses outright
 * (`money.ts:42-47`) — so one tap of `+` on a line sold by weight would make
 * the whole sale a 422 for a quantity nobody typed. It only ever cancels float
 * noise from an addition; it never rounds a number the cashier entered.
 */
const round3 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1000) / 1000;

/** The canvas's 38px cell: a caption on the left, the value right-aligned. */
const CELL =
  "flex h-[38px] min-w-0 flex-1 items-center justify-between gap-2 rounded-[9px] border border-border bg-background px-2.5";

const CAPTION =
  "flex-none font-mono text-[10px] uppercase tracking-[0.06em] text-muted-2";

const STEP_BUTTON =
  "flex size-[38px] flex-none items-center justify-center text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-40";

export interface CartLineRowProps {
  line: CartLine;
  /** The business's MAIN currency code — every figure on this row is in it. */
  currency: string;
  /**
   * The refusal that belongs on this row, if any: a 409 `INSUFFICIENT_STOCK`'s
   * shortfall, or a discount larger than the line is worth.
   */
  error?: string;
  disabled?: boolean;
}

/**
 * One rung-up line — artboard `2a`'s cart row: the name and its total, then a
 * quantity stepper, the unit, an editable unit price, a line discount and a
 * remove control.
 *
 * **The 409 goes here, not in a toast.** `INSUFFICIENT_STOCK` carries
 * `details: { productId, requested, available }` (`docs/contracts/sales.md`
 * §7), which is exactly enough to name the row that has to change — and the
 * fix is on this row, in the stepper. A toast would take the sentence away from
 * the number it is about, and this repo has already made that call twice
 * (`category-tab.tsx`, `customer-detail.tsx`).
 *
 * Every write goes straight to the cart store. **No arithmetic happens here**:
 * `lineTotal` is the store's transcription of `sale.service.ts:155`, and a
 * second copy in a component is how a cart and a receipt end up a cent apart.
 */
export function CartLineRow({
  line,
  currency,
  error,
  disabled,
}: CartLineRowProps) {
  const uid = useId();
  const errorId = `${uid}-error`;

  const setQuantity = useCartStore((state) => state.setQuantity);
  const setUnitPrice = useCartStore((state) => state.setUnitPrice);
  const setLineDiscount = useCartStore((state) => state.setLineDiscount);
  const removeLine = useCartStore((state) => state.removeLine);

  const total = lineTotal(line);
  const step = (delta: number) => {
    const next = round3(line.quantity + delta);
    // `quantitySchema` is strictly positive — `0` is rejected, not merely
    // discouraged — so the floor is a removal, which is what the bin is for.
    if (next > 0) setQuantity(line.productId, next);
  };

  return (
    <div className="flex flex-col gap-2.5 border-border/60 border-b px-5 py-3.5 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-medium text-[14px] text-foreground">
          {line.name}
        </span>
        <span
          className={cn(
            "flex-none font-mono text-[14px]",
            total < 0 ? "text-destructive-strong" : "text-foreground",
          )}
        >
          {formatMoney(total, currency)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex flex-none items-center overflow-hidden rounded-[9px] border border-border bg-background">
          <button
            type="button"
            aria-label={`One less ${line.name}`}
            disabled={disabled || round3(line.quantity - 1) <= 0}
            onClick={() => step(-1)}
            className={STEP_BUTTON}
          >
            <Minus className="size-4" aria-hidden="true" />
          </button>
          <NumericCell
            label={`Quantity of ${line.name} in ${line.unit}`}
            value={line.quantity}
            decimals={3}
            disabled={disabled}
            invalid={error !== undefined}
            describedBy={error ? errorId : undefined}
            onCommit={(value) => {
              // An empty box, or a `0`, is not a quantity this endpoint
              // accepts. Nothing is committed and the blur restores what the
              // cart still holds, so a half-typed `0.` never becomes a 422.
              if (value !== null && value > 0) {
                setQuantity(line.productId, value);
              }
            }}
            className="w-[52px] text-center text-[14px]"
          />
          <button
            type="button"
            aria-label={`One more ${line.name}`}
            disabled={disabled}
            onClick={() => step(1)}
            className={STEP_BUTTON}
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>

        <span className="flex-none font-mono text-[12px] text-muted-foreground">
          {line.unit}
        </span>

        <div className={CELL}>
          <span className={CAPTION} aria-hidden="true">
            Unit
          </span>
          <NumericCell
            label={`Unit price of ${line.name} in ${currency}`}
            value={line.unitPrice}
            decimals={2}
            disabled={disabled}
            // Clearing the box is not the same as pricing the line at zero.
            // Type a `0` to give something away; an empty box restores the
            // price on blur.
            onCommit={(value) => {
              if (value !== null) setUnitPrice(line.productId, value);
            }}
            className="w-full text-right text-[13px]"
          />
        </div>

        <div className={CELL}>
          <span className={CAPTION} aria-hidden="true">
            Disc
          </span>
          <NumericCell
            // An **amount**, never a percentage — both discount fields on this
            // endpoint are money (`docs/contracts/sales.md` §6).
            label={`Discount on ${line.name} in ${currency}`}
            value={line.discount}
            decimals={2}
            disabled={disabled}
            invalid={total < 0}
            onCommit={(value) => {
              if (value !== null) setLineDiscount(line.productId, value);
            }}
            className="w-full text-right text-[13px]"
          />
        </div>

        <button
          type="button"
          aria-label={`Remove ${line.name}`}
          disabled={disabled}
          onClick={() => removeLine(line.productId)}
          className="flex size-[38px] flex-none items-center justify-center rounded-[9px] text-muted-3 transition-colors outline-none hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>

      {error ? (
        <p
          id={errorId}
          className="flex items-start gap-[7px] text-[12px] text-destructive-strong"
        >
          <TriangleAlert
            className="mt-px size-3.5 flex-none"
            aria-hidden="true"
          />
          {error}
        </p>
      ) : null}
    </div>
  );
}
