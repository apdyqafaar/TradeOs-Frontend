"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCan } from "@/features/auth/hooks/use-permission";
import { StockBadge } from "@/features/products/components/stock-badge";
import {
  StockDialog,
  type StockDialogType,
} from "@/features/products/components/stock-dialog";
import type { Product } from "@/features/products/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatQuantity } from "@/lib/format/money";

interface StockCardProps {
  /**
   * A **tracked** product. `trackStock: false` has no stock at all — not a
   * stock of zero — so the caller renders a muted line instead of this card
   * and never a version of it with the numbers blanked out. `ProductDetail`
   * owns that branch because it makes the same one for the movements table.
   */
  product: Product;
}

/**
 * The stock card of artboard `2d`: the quantity a shop trusts, the alarm set on
 * it, and the only two controls that can move it.
 *
 * **The quantity and its Low/Out pill come from `<StockBadge>`**, the same
 * component the products table renders, rather than from a second comparison
 * written here. "At or below the threshold is low, and out beats low" is a rule
 * with three places it can disagree with itself — this card, the table, and the
 * backend's `lowStock=true` filter — and a product that reads `Low` in a list
 * and healthy on its own page is the bug that follows from writing it twice.
 * The badge is scaled to the canvas's 34px headline through a child selector;
 * see the note on `className` below.
 *
 * `Restock` and `Adjust` are gated on `products:adjust_stock` and are simply
 * absent without it (brief §1.1 — a Seller must not learn the control exists),
 * and absent on an archived product too, because `POST /products/:id/stock`
 * refuses one with 409 `STOCK_NOT_TRACKED`.
 */
export function StockCard({ product }: StockCardProps) {
  const canAdjust = useCan(PERMISSIONS.PRODUCTS_ADJUST_STOCK);

  /**
   * Two pieces of state rather than one `StockDialogType | null`, so the type
   * survives the close: a single nullable value would flip the dialog's title
   * back to "Restock" halfway through its own fade-out.
   */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<StockDialogType>("restock");

  const openDialog = (type: StockDialogType) => {
    setDialogType(type);
    setDialogOpen(true);
  };

  const isArchived = product.status === "archived";
  const canMove = canAdjust && !isArchived;

  return (
    <section className="flex flex-wrap items-center justify-between gap-5 rounded-[10px] border border-border bg-card p-[18px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          In stock
        </h2>

        {/*
          `[&>span:first-child]` reaches the quantity span inside `<StockBadge>`
          so the number carries the canvas's 34px headline weight while the
          Low/Out pill keeps its own 11px. The alternative was a `size` prop on
          the badge, which is another lane's file — and re-deriving the pill here
          to avoid the selector would be the duplication the badge exists to
          prevent. The unit rides at the headline size with the number rather
          than at the canvas's 13px, which is the one pixel-level concession.
        */}
        <StockBadge
          trackStock
          quantity={product.quantity}
          unit={product.unit}
          lowStockThreshold={product.lowStockThreshold}
          className="items-baseline gap-2.5 [&>span:first-child]:font-medium [&>span:first-child]:text-[34px]"
        />

        <p className="text-[12px] text-muted-foreground">
          {product.lowStockThreshold === undefined
            ? // Not "Alert below 0": no alarm is set, and this product can never
              // read Low or appear on the Low stock tab, however few are left.
              "No low-stock alert set"
            : `Alert below ${formatQuantity(product.lowStockThreshold, product.unit)}`}
        </p>
      </div>

      {canMove ? (
        <div className="flex gap-2.5">
          <Button
            className="h-10 rounded-[10px] px-4 text-[13px]"
            onClick={() => openDialog("restock")}
          >
            Restock
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-[10px] px-4 text-[13px]"
            onClick={() => openDialog("adjustment")}
          >
            Adjust
          </Button>
        </div>
      ) : isArchived && canAdjust ? (
        <p className="max-w-[220px] text-[12px] text-muted-foreground">
          Stock cannot move on an archived product. Restore it first.
        </p>
      ) : null}

      {/*
        Mounted only where the buttons are, so nothing that could open it exists
        for a caller who may not move stock. It stays mounted while closed —
        `Dialog.Portal` puts nothing in the document then — because unmounting
        on close is what would cut the closing transition off.

        `quantity` is this page's copy, which is what the preview adds to. The
        mutation seeds `productKeys.detail(id)` from the server's response, so
        the same write that makes this number stale is the one that corrects it.
      */}
      {canMove ? (
        <StockDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          productId={product.id}
          productName={product.name}
          quantity={product.quantity}
          unit={product.unit}
          type={dialogType}
        />
      ) : null}
    </section>
  );
}
