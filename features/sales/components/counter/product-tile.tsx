"use client";

import { cn } from "cn";
import { StockBadge } from "@/features/products/components/stock-badge";
import type { Product } from "@/features/products/types";
import { formatMoney } from "@/lib/format/money";

export interface ProductTileProps {
  product: Product;
  /** The business's MAIN currency code. Never a symbol, never a literal. */
  currency: string;
  onAdd: (product: Product) => void;
  disabled?: boolean;
}

/**
 * True when ringing this product up is certain to be refused.
 *
 * Only a **tracked** product can be out: `trackStock: false` is a service or a
 * fee, whose `quantity` is a frozen number the API refuses to move at all
 * (`Product.trackStock`), so a delivery charge sitting at `0` is perfectly
 * sellable. Reading `quantity <= 0` alone would grey out every service in the
 * catalogue.
 *
 * This is the same threshold `StockBadge` calls "Out", deliberately — a tile
 * that says Out and still adds to the cart is worse than either behaviour on
 * its own.
 */
export const isOutOfStock = (product: Product): boolean =>
  product.trackStock && product.quantity <= 0;

/**
 * One product in the counter's grid — artboard `2a`, the 3-column tile: an
 * 88px image band, the name, the price and the stock line.
 *
 * **An out-of-stock tile is dimmed and inert**, not merely faded. The sale
 * would come back 409 `INSUFFICIENT_STOCK` from the guarded decrement
 * (`docs/contracts/sales.md` §8, "oversell is impossible"), and a cart line
 * that can never be completed is worse than a product that visibly cannot be
 * added: the cashier finds out at the end of the sale instead of at the shelf.
 *
 * The pill and the stock line come from the shared `StockBadge` rather than
 * being drawn again here. The canvas puts the pill up beside the price and the
 * quantity on its own line below; `StockBadge` keeps them together on the
 * second line. That is the deliberate difference — "low" and "out" are decided
 * in exactly one place in this app, and a second copy of those thresholds would
 * be a tile disagreeing with the product table about the same shelf.
 */
export function ProductTile({
  product,
  currency,
  onAdd,
  disabled,
}: ProductTileProps) {
  const out = isOutOfStock(product);
  const image = product.images[0];

  return (
    <button
      type="button"
      disabled={disabled || out}
      onClick={() => onAdd(product)}
      title={out ? `${product.name} is out of stock` : undefined}
      className={cn(
        "flex flex-col overflow-hidden rounded-[10px] border border-border bg-card text-left transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        out
          ? "opacity-50"
          : "hover:border-border-strong disabled:opacity-50 active:translate-y-px",
      )}
    >
      <span className="flex h-[88px] items-center justify-center border-border border-b bg-muted">
        {image ? (
          // A plain `<img>`, not `next/image`, for the reason
          // `product-table.tsx` gives: the S3 host comes from
          // `NEXT_PUBLIC_S3_HOSTNAME`, `next.config.ts` leaves
          // `images.remotePatterns` empty when that is unset — which is every
          // development machine — and `next/image` throws on an unconfigured
          // host.
          // biome-ignore lint/performance/noImgElement: see above
          <img src={image.thumbUrl} alt="" className="size-full object-cover" />
        ) : (
          // The canvas's hatched placeholder, in tokens so it follows the
          // theme. Most of a real shop's catalogue has no photograph, and a
          // grid of package icons reads as a grid of failed images.
          <span
            aria-hidden="true"
            className="size-full"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--surface-2) 0 6px, var(--muted) 6px 12px)",
            }}
          />
        )}
      </span>

      <span className="flex flex-col gap-2 px-3.5 py-3">
        <span className="truncate font-medium text-[14px] text-foreground">
          {product.name}
        </span>
        <span className="font-mono text-[14px] text-foreground">
          {formatMoney(product.sellingPrice, currency)}
        </span>
        <StockBadge
          trackStock={product.trackStock}
          quantity={product.quantity}
          unit={product.unit}
          lowStockThreshold={product.lowStockThreshold}
        />
      </span>
    </button>
  );
}
