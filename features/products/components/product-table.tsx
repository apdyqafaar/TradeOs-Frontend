"use client";

import { cn } from "cn";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { ROUTES } from "@/config/routes";
import { StockBadge } from "@/features/products/components/stock-badge";
import type { Product } from "@/features/products/types";
import type { PageMeta } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";

const STATUS_STYLES: Record<Product["status"], string> = {
  active: "bg-success-soft text-success-strong",
  archived: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<Product["status"], string> = {
  active: "Active",
  archived: "Archived",
};

interface ProductTableProps {
  rows: Product[];
  /** Absent until the first page has landed. */
  meta?: PageMeta;
  /**
   * The business's currency **code**, from `useOrganization()`. Never a
   * hardcoded one and never a symbol: this market mixes currencies whose
   * symbols collide. `""` is a real value — a business with no currency
   * configuration — and renders the amounts unlabelled rather than guessing.
   */
  currency: string;
  isLoading: boolean;
  /** A refetch is in flight over rows already on screen: dim, do not blank. */
  isStale: boolean;
  emptyState: ReactNode;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

/**
 * The products table of artboard `2c`.
 *
 * Presentational: it is handed rows and hands back page changes. The query
 * lives one level up in `<ProductsPage>`, which needs `meta.total` for the
 * count beside the title and so would otherwise have to run it twice.
 *
 * **No column is sortable.** `listProductsQuerySchema` is `.strict()` and
 * accepts `page`, `limit`, `search`, `status`, `categoryId` and `lowStock` —
 * there is no `sort` key, so `<DataTable>`'s sorting props are deliberately
 * not passed. Sorting the 25 rows in memory would silently reorder one page of
 * N and lie about the rest.
 */
export function ProductTable({
  rows,
  meta,
  currency,
  isLoading,
  isStale,
  emptyState,
  onPageChange,
  onLimitChange,
}: ProductTableProps) {
  const router = useRouter();

  const money = (amount: number) => formatMoney(amount, currency).trim();

  const columns: DataTableColumn<Product>[] = [
    {
      key: "product",
      header: "Product",
      cell: (product) => (
        <div className="flex items-center gap-3">
          <ProductThumb product={product} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] text-foreground">
              {product.name}
            </span>
            {/* Mono, because a barcode is read digit by digit and compared
                against a scanner's output. Absent on most products — a shop
                types half its catalogue in by hand — so nothing takes its
                place rather than a dash pretending to be a code. */}
            {product.barcode ? (
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {product.barcode}
              </span>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      hideBelowMd: true,
      cell: (product) => (
        <span className="text-[13px] text-muted-foreground">
          {/* `category: null` is not "uncategorised" — every product has one.
              It means the category row is gone, which is a broken record, not
              a blank field. A muted dash says so without inventing a name. */}
          {product.category?.name ?? "—"}
        </span>
      ),
    },
    {
      key: "unit",
      header: "Unit",
      hideBelowMd: true,
      cell: (product) => (
        <span className="font-mono text-xs text-muted-foreground">
          {product.unit}
        </span>
      ),
    },
    {
      key: "costPrice",
      header: "Cost",
      align: "end",
      hideBelowMd: true,
      cell: (product) => (
        <span className="font-mono text-[13px] text-muted-foreground">
          {money(product.costPrice)}
        </span>
      ),
    },
    {
      key: "sellingPrice",
      header: "Price",
      align: "end",
      cell: (product) => (
        <span className="font-mono text-[13px] text-foreground">
          {money(product.sellingPrice)}
        </span>
      ),
    },
    {
      key: "stock",
      header: "Stock",
      align: "end",
      cell: (product) => (
        // `formatQuantity`, not `formatMoney`: a product sold by weight has a
        // quantity of 1.5 and up to 3 dp. StockBadge does that formatting.
        <StockBadge
          trackStock={product.trackStock}
          quantity={product.quantity}
          unit={product.unit}
          lowStockThreshold={product.lowStockThreshold}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "end",
      cell: (product) => (
        <span
          className={cn(
            "inline-flex h-[22px] items-center rounded-lg px-2 text-[11px] font-medium",
            STATUS_STYLES[product.status],
          )}
        >
          {STATUS_LABELS[product.status]}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption="Products"
      columns={columns}
      rows={rows}
      getRowId={(product) => product.id}
      isLoading={isLoading}
      isStale={isStale}
      emptyState={emptyState}
      onRowClick={(product) => router.push(ROUTES.product(product.id))}
      pagination={meta ? { ...meta, onPageChange, onLimitChange } : undefined}
    />
  );
}

/**
 * The 36px swatch at the head of each row.
 *
 * A plain `<img>`, not `next/image`, for the same reason as
 * `features/uploads/components/image-picker.tsx`: the S3 host comes from
 * `NEXT_PUBLIC_S3_HOSTNAME`, `next.config.ts` leaves `images.remotePatterns`
 * empty when that is unset — which is every development machine — and
 * `next/image` throws on an unconfigured host.
 *
 * The placeholder is the canvas's hatched tile rather than an icon: most rows
 * in a real shop's catalogue have no photograph, and a row of package icons
 * would read as a column of failed images.
 */
function ProductThumb({ product }: { product: Product }) {
  const image = product.images[0];

  if (!image) {
    return (
      <span
        aria-hidden="true"
        className="size-9 flex-none rounded-lg border border-border bg-muted"
      />
    );
  }

  return (
    // biome-ignore lint/performance/noImgElement: see the note above
    <img
      src={image.thumbUrl}
      alt=""
      className="size-9 flex-none rounded-lg border border-border object-cover"
    />
  );
}
