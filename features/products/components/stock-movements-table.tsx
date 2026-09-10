"use client";

import { History } from "lucide-react";
import { parseAsInteger, useQueryStates } from "nuqs";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { useStockMovements } from "@/features/products/hooks/use-stock-movements";
import type {
  StockMovement,
  StockMovementType,
} from "@/features/products/types";
import { MemberRef } from "@/features/team/components/member-ref";
import type { ObjectId } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format/date";
import { formatQuantity } from "@/lib/format/money";

const TYPE_LABELS: Record<StockMovementType, string> = {
  sale: "Sale",
  sale_void: "Sale void",
  restock: "Restock",
  adjustment: "Adjustment",
};

/**
 * A movement is read as "did stock go up or down, and did a person do it?", so
 * the colours group by direction and not by rarity: the two that add stock are
 * green, the sale that removes it is quiet (it is the normal case, and a
 * coloured pill on every second row means nothing), and the adjustment — the
 * only one a human typed a reason for — is the one that stands out.
 */
const TYPE_STYLES: Record<StockMovementType, string> = {
  sale: "bg-muted text-muted-foreground",
  sale_void: "bg-success-soft text-success-strong",
  restock: "bg-success-soft text-success-strong",
  adjustment: "bg-info-soft text-info-strong",
};

const MOVEMENT_PAGE_PARSERS = {
  /**
   * `mvPage`, not `page`: this table shares a URL with nothing today, but the
   * detail screen is the one place a second paginated list is likely to land
   * (Slice 3's sales for this product), and two lists writing `?page=` would
   * page each other.
   */
  mvPage: parseAsInteger.withDefault(1),
  mvLimit: parseAsInteger.withDefault(25),
};

interface StockMovementsTableProps {
  productId: ObjectId;
  /** The product's unit. Every number in this table is a quantity, not money. */
  unit: string;
}

/**
 * A product's audit trail — artboard `2d`'s lower panel.
 *
 * Rendered only for a tracked product; `ProductDetail` owns that branch, and an
 * empty table under a service would read as "nothing has happened yet" rather
 * than "this cannot happen".
 *
 * Three things the canvas draws that the payload cannot fill, all of them
 * decided here rather than invented:
 *
 *   1. **"last 30 days"** in the panel header. `GET /products/:id/stock-movements`
 *      takes `page` and `limit` and nothing else (`paginationQuerySchema.strict()`),
 *      so there is no date window to honour and no way to build one that would
 *      not lie about the rows it excluded. The header says `newest first`, which
 *      is what the endpoint actually guarantees.
 *   2. **The "Who" column.** `StockMovement.createdBy` is a bare member id —
 *      `publicMovement` does `movement.createdBy.toString()` — and there is no
 *      name anywhere in this response. `<MemberRef>` resolves it against the
 *      shared team directory, which costs one request no matter how many rows
 *      ask, and falls back to the em dash with the id in its `title` when the
 *      directory cannot name them or the caller may not read it. `docs/findings/s2-task-07.md` has the full reasoning
 *      and what turning it on would cost.
 *   3. **A link to the receipt.** A `sale` or `sale_void` carries a `saleId`,
 *      but `/sales/[id]` does not exist until Slice 3, so the reference is
 *      plain text.
 */
export function StockMovementsTable({
  productId,
  unit,
}: StockMovementsTableProps) {
  const { timezone, isLoading: organizationLoading } = useOrganization();
  const [{ mvPage, mvLimit }, setPaging] = useQueryStates(
    MOVEMENT_PAGE_PARSERS,
    { history: "replace", scroll: false },
  );

  const movements = useStockMovements(productId, {
    page: mvPage,
    limit: mvLimit,
  });
  const { data, error, isPending, isPlaceholderData, refetch } = movements;

  const columns: DataTableColumn<StockMovement>[] = [
    {
      key: "type",
      header: "Type",
      cell: (movement) => (
        <span
          className={`inline-flex h-[22px] items-center rounded-lg px-2 font-medium text-[11px] ${TYPE_STYLES[movement.type]}`}
        >
          {TYPE_LABELS[movement.type]}
        </span>
      ),
    },
    {
      key: "change",
      header: "Change",
      align: "end",
      cell: (movement) => (
        // The sign is the column. `formatQuantity` prints a minus for a sale
        // and nothing at all for a restock, so the plus is added back — a
        // column where half the values are unsigned reads as absolute values.
        <span className="font-mono text-[13px] text-foreground">
          {movement.quantity > 0 ? "+" : ""}
          {formatQuantity(movement.quantity, unit)}
        </span>
      ),
    },
    {
      key: "quantityAfter",
      header: "Result",
      align: "end",
      hideBelowMd: true,
      cell: (movement) => (
        <span className="font-mono text-[13px] text-muted-foreground">
          {formatQuantity(movement.quantityAfter, unit)}
        </span>
      ),
    },
    {
      key: "createdBy",
      header: "Who",
      hideBelowMd: true,
      cell: (movement) => (
        <MemberRef memberId={movement.createdBy} action="Recorded" />
      ),
    },
    {
      key: "createdAt",
      header: "When",
      hideBelowMd: true,
      cell: (movement) => (
        <span className="font-mono text-[12px] text-muted-foreground">
          {formatDateTime(movement.createdAt, timezone)}
        </span>
      ),
    },
    {
      key: "note",
      header: "Reason / receipt",
      cell: (movement) => <MovementNote movement={movement} />,
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium font-mono text-[11px] uppercase tracking-[0.08em] text-foreground">
          Stock movements
        </h2>
        {/*
          The canvas reads "last 30 days" here. The endpoint has no date filter
          at all, so that caption would describe a window nothing applies —
          see the note on this component.
        */}
        <span className="font-mono text-[11px] text-muted-foreground">
          newest first
        </span>
      </div>

      {error ? (
        <ErrorCard
          error={error}
          title="Couldn't load the stock movements"
          retry={() => {
            void refetch();
          }}
        />
      ) : null}

      <DataTable
        caption="Stock movements"
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(movement) => movement.id}
        // The `When` column is in the business timezone, so rows must not land
        // before it does — a row that redraws its date a beat later reads as a
        // bug rather than as a load.
        isLoading={isPending || organizationLoading}
        isStale={isPlaceholderData}
        emptyState={
          <EmptyState
            title="No movements yet"
            description="Every restock, adjustment, sale and void appears here with what it changed and why."
            icon={History}
          />
        }
        pagination={
          data
            ? {
                ...data.meta,
                onPageChange: (page) => void setPaging({ mvPage: page }),
                onLimitChange: (limit) =>
                  void setPaging({ mvLimit: limit, mvPage: 1 }),
              }
            : undefined
        }
      />
    </section>
  );
}

/**
 * The last column: why a person moved the stock, or which receipt moved it.
 *
 * A `sale_void` carries a `saleId` and **no reason at all** — the void's own
 * reason is stored on the sale, not copied onto the movement
 * (`voidSale` in `../Backend/src/services/sale.service.ts:307-317` builds the
 * row without one) — so the receipt reference is the whole cell for both sale
 * types.
 */
function MovementNote({ movement }: { movement: StockMovement }) {
  if (movement.reason) {
    return (
      <span
        className="block truncate text-[12px] text-muted-foreground"
        title={movement.reason}
      >
        {movement.reason}
      </span>
    );
  }

  if (movement.saleId) {
    return (
      // TODO(slice: 3): link this to `ROUTES.sale(movement.saleId)` once
      // `app/(app)/sales/[id]/page.tsx` exists. A link today lands on a
      // not-found. The id is shortened because the movement carries the sale's
      // ObjectId and not its receipt number — nothing in this payload knows
      // what the counter printed.
      <span
        className="font-mono text-[12px] text-muted-foreground"
        title={`Sale ${movement.saleId}`}
      >
        Sale …{movement.saleId.slice(-6)}
      </span>
    );
  }

  return <span className="text-[12px] text-muted-foreground">—</span>;
}
