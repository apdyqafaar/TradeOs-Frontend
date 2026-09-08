import { cn } from "cn";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ROUTES } from "@/config/routes";
import { PanelFigure } from "@/features/dashboard/components/debts-section";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import type { DashboardStockSection } from "@/features/dashboard/types";
import { formatQuantity } from "@/lib/format/money";

interface StockSectionProps {
  section: DashboardStockSection;
}

/**
 * Low and out-of-stock products (design canvas artboard `1c`, right of the
 * Debts/Stock band).
 *
 * The two counts are the *lengths of the stock report's lists*, and those lists
 * are capped at 50 upstream — a business with 300 low products reports 50. The
 * `info` note says so on the panel rather than in a comment nobody reading the
 * screen can see.
 */
export function StockSection({ section }: StockSectionProps) {
  return (
    <SectionStrip
      title="Stock"
      info="Counts come from the stock report, which lists at most 50 products of each kind — a larger business reads 50, not its true total."
      actions={
        <Link
          href={ROUTES.products}
          className="text-xs font-medium text-primary hover:underline"
        >
          Low stock
        </Link>
      }
      className="flex flex-col"
    >
      <div className="flex flex-wrap gap-x-7 gap-y-4 border-b border-border px-[18px] py-4">
        <PanelFigure
          label="Low"
          value={String(section.lowStockCount)}
          tone="text-warning-strong"
        />
        <PanelFigure
          label="Out of stock"
          value={String(section.outOfStockCount)}
          tone="text-destructive"
        />
      </div>

      {section.lowStock.length === 0 ? (
        <EmptyState
          title="Stock is healthy"
          description="Products at or under their threshold appear here."
        />
      ) : (
        <ul className="flex flex-col">
          {section.lowStock.map((product) => {
            const isOut = product.quantity <= 0;
            return (
              <li
                key={product.productId}
                className="flex h-11 items-center justify-between gap-3 border-b border-border/60 px-[18px] last:border-b-0"
              >
                <span className="truncate text-[13px] text-foreground">
                  {product.name}
                </span>
                <span className="flex flex-none items-center gap-2">
                  {/* `threshold` is `number | null` — a product can be tracked
                      without one, and "0" would be a different, wrong claim. */}
                  <span className="font-mono text-xs text-muted-foreground">
                    {product.threshold === null
                      ? "no threshold"
                      : `min ${formatQuantity(product.threshold)}`}
                  </span>
                  <span className="font-mono text-[13px] text-foreground">
                    {formatQuantity(product.quantity)}
                  </span>
                  <span
                    className={cn(
                      "inline-flex h-[22px] items-center rounded-lg px-2 text-[11px] font-medium",
                      isOut
                        ? "bg-destructive-soft text-destructive-strong"
                        : "bg-warning-soft text-warning-strong",
                    )}
                  >
                    {isOut ? "Out" : "Low"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionStrip>
  );
}
