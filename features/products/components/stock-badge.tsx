import { cn } from "cn";
import { formatQuantity } from "@/lib/format/money";

interface StockBadgeProps {
  /**
   * `false` means a service or a fee — the product has no stock at all, not a
   * stock of zero. See `Product.trackStock` in `../types.ts`.
   */
  trackStock: boolean;
  /** Up to 3 dp: goods are sold by weight. */
  quantity: number;
  /** `pcs`, `kg`, `carton` — rendered beside the number, never assumed. */
  unit: string;
  /**
   * Absent when the business set no alarm on this product. A tracked product
   * with no threshold can never read `Low`, however small the quantity: there
   * is nothing to compare it against, and picking a number here would invent
   * an alarm the business never set (and one the backend's `lowStock=true`
   * filter would not agree with).
   */
  lowStockThreshold?: number;
  className?: string;
}

/** The three pill treatments, matching artboard `2c` and the Overview's stock strip. */
const PILL =
  "inline-flex h-[22px] flex-none items-center rounded-lg px-2 text-[11px] font-medium";

/**
 * A product's stock, as the canvas draws it: the quantity in mono, and a pill
 * beside it only when something is wrong.
 *
 * Four states, and the order they are tested in is the whole component:
 *
 * 1. **Untracked** — no quantity is rendered at all. Printing `0 pcs` for a
 *    delivery fee would read as "sold out" and send someone to restock a
 *    thing that cannot be restocked (`POST /products/:id/stock` answers 409
 *    `STOCK_NOT_TRACKED`).
 * 2. **Out** — `quantity <= 0`, checked before the threshold so an empty shelf
 *    never reads as merely `Low`. It applies with or without a threshold,
 *    because "there are none" needs no alarm to be true.
 * 3. **Low** — at or *under* the threshold, inclusive, which is what the
 *    backend's filter means by low (`quantity <= lowStockThreshold`). An
 *    exclusive comparison here would show a product on the Low stock tab with
 *    no badge on its row.
 * 4. **Healthy** — the quantity and its unit, and no pill. Quiet is the point:
 *    a badge on every row is a badge that means nothing.
 *
 * Shared with the product detail's stock card (Task 7), so it takes four plain
 * values rather than a `Product` — the detail page has one, the table row has
 * one, and a test needs neither.
 */
export function StockBadge({
  trackStock,
  quantity,
  unit,
  lowStockThreshold,
  className,
}: StockBadgeProps) {
  if (!trackStock) {
    return (
      <span
        className={cn(PILL, "bg-muted text-muted-foreground", className)}
        title="Stock is not tracked for this product"
      >
        Untracked
      </span>
    );
  }

  const isOut = quantity <= 0;
  const isLow =
    !isOut && lowStockThreshold !== undefined && quantity <= lowStockThreshold;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="font-mono text-[13px] text-foreground">
        {formatQuantity(quantity, unit)}
      </span>
      {isOut ? (
        <span
          className={cn(PILL, "bg-destructive-soft text-destructive-strong")}
        >
          Out
        </span>
      ) : null}
      {isLow ? (
        <span className={cn(PILL, "bg-warning-soft text-warning-strong")}>
          Low
        </span>
      ) : null}
    </span>
  );
}
