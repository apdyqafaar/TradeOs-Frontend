"use client";

import { TriangleAlert } from "lucide-react";
import { CartLineRow } from "@/features/sales/components/counter/cart-line";
import type { CartLine } from "@/features/sales/store/cart";
import type { ObjectId } from "@/lib/api/types";

export interface CartPaneProps {
  lines: CartLine[];
  /** The business's MAIN currency code. Every figure in the cart is in it. */
  currency: string;
  /** `productId` → the refusal that belongs on that row. */
  lineErrors?: Record<ObjectId, string>;
  /**
   * A refusal with no row to sit on: an archived product (the message names it
   * but carries no id), or a product that stopped existing mid-shift.
   */
  error?: string;
  onClear: () => void;
  disabled?: boolean;
}

/**
 * The cart itself — the top of artboard `2a`'s 480px column: the header with
 * its line count and Clear, then one row per line.
 *
 * It reads nothing and derives nothing. The lines and every total come from the
 * store through `counter.tsx`, because the store is where the server's
 * arithmetic is transcribed and tested.
 */
export function CartPane({
  lines,
  currency,
  lineErrors,
  error,
  onClear,
  disabled,
}: CartPaneProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-border border-b px-5 py-4">
        <span className="flex-1 font-medium font-mono text-[11px] text-foreground uppercase tracking-[0.08em]">
          {`Cart · ${lines.length} ${lines.length === 1 ? "line" : "lines"}`}
        </span>
        {lines.length > 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            className="rounded-[6px] text-[13px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            Clear
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="flex items-start gap-2 border-border/60 border-b bg-destructive-soft px-5 py-3 text-[13px] text-destructive-strong">
          <TriangleAlert
            className="mt-px size-4 flex-none"
            aria-hidden="true"
          />
          {error}
        </p>
      ) : null}

      {lines.length === 0 ? (
        // The canvas draws no empty cart. Quiet, and it says what puts
        // something here rather than that there is nothing.
        <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">
          Nothing rung up yet. Scan a barcode or tap a product.
        </p>
      ) : (
        lines.map((line) => (
          <CartLineRow
            key={line.productId}
            line={line}
            currency={currency}
            error={lineErrors?.[line.productId]}
            disabled={disabled}
          />
        ))
      )}
    </div>
  );
}
