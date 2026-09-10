"use client";

import { cn } from "cn";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { ROUTES } from "@/config/routes";
import type {
  Sale,
  SalePaymentStatus,
  SaleStatus,
} from "@/features/sales/types";
import { MemberRef } from "@/features/team/components/member-ref";
import type { ObjectId, PageMeta } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";

/**
 * The payment pill of artboards `2b` and `2f`.
 *
 * Grouped by what the shop is owed, not by rarity: `paid` is settled and
 * green, `partial` is the gold "Partial" pill the receipt header draws, and
 * `credit` — nothing tendered at all — carries the same red the receipt's
 * `Amount due` line uses, so a row and its receipt agree on the colour of
 * money that is still outstanding.
 */
const PAYMENT_STATUS_STYLES: Record<SalePaymentStatus, string> = {
  paid: "bg-success-soft text-success-strong",
  partial: "bg-warning-soft text-warning-strong",
  credit: "bg-destructive-soft text-destructive-strong",
};

const PAYMENT_STATUS_LABELS: Record<SalePaymentStatus, string> = {
  paid: "Paid",
  partial: "Partial",
  credit: "Credit",
};

const STATUS_LABELS: Record<SaleStatus, string> = {
  completed: "Completed",
  voided: "Voided",
};

interface SaleTableProps {
  rows: Sale[];
  /** Absent until the first page has landed. */
  meta?: PageMeta;
  /**
   * The business's main currency **code**, from `useOrganization()`. Never a
   * symbol and never hardcoded — this market mixes currencies whose symbols
   * collide. `""` is a real value (a business with no currency configuration)
   * and renders the amounts unlabelled rather than guessing.
   *
   * Every amount in this table is `sale.total`, which is in the main currency
   * whatever the customer tendered in — see `SalePayment` in `../types`.
   */
  currency: string;
  /** IANA zone from `useOrganization()`. A shop's day is its own. */
  timezone: string;
  isLoading: boolean;
  /** A refetch is in flight over rows already on screen: dim, do not blank. */
  isStale: boolean;
  emptyState: ReactNode;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

/**
 * The sales journal — brief §6.4's list, one row per receipt.
 *
 * Presentational: it is handed rows and hands back page changes. The query
 * lives one level up in `<SalesPage>`, which needs `meta.total` for the count
 * beside the title and would otherwise have to run it twice.
 *
 * **No column is sortable.** `listSalesQuerySchema` is `.strict()` and has no
 * `sort` key — the order is fixed at `createdAt: -1, _id: -1`, newest first
 * (`sale.actions.ts:59-60`) — so `<DataTable>`'s sorting props are
 * deliberately not passed. Sorting the 25 rows in memory would reorder one
 * page of N and lie about the rest.
 *
 * **A voided row is muted with a struck-through number and total** rather than
 * hidden: `status` defaults to `all` server-side, so an unfiltered list
 * contains them, and voiding never removes a receipt.
 */
export function SaleTable({
  rows,
  meta,
  currency,
  timezone,
  isLoading,
  isStale,
  emptyState,
  onPageChange,
  onLimitChange,
}: SaleTableProps) {
  const router = useRouter();

  const columns: DataTableColumn<Sale>[] = [
    {
      key: "number",
      header: "Receipt",
      cell: (sale) => (
        // Mono, and the whole point of the column: `S-000129` is read digit by
        // digit off a printed slip and compared with what is on screen.
        <span
          className={cn(
            "font-mono text-[13px]",
            sale.status === "voided"
              ? "text-muted-2 line-through"
              : "text-foreground",
          )}
        >
          {sale.number}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "When",
      cell: (sale) => (
        <span className="font-mono text-[12px] text-muted-foreground">
          {formatDateTime(sale.createdAt, timezone)}
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      hideBelowMd: true,
      cell: (sale) => <CustomerRef customerId={sale.customerId} />,
    },
    {
      key: "items",
      header: "Items",
      align: "end",
      hideBelowMd: true,
      cell: (sale) => (
        // How many lines, not how many units: a line of 12 crates is one line.
        // `items` is always on the wire in full, so this needs no extra request.
        <span className="font-mono text-[13px] text-muted-foreground">
          {sale.items.length}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "end",
      cell: (sale) => (
        <span
          className={cn(
            "font-mono text-[13px]",
            sale.status === "voided"
              ? "text-muted-2 line-through"
              : "text-foreground",
          )}
        >
          {formatMoney(sale.total, currency)}
        </span>
      ),
    },
    {
      key: "paymentStatus",
      header: "Payment",
      align: "end",
      cell: (sale) => (
        <span
          className={cn(
            "inline-flex h-[22px] items-center rounded-lg px-2 font-medium text-[11px]",
            PAYMENT_STATUS_STYLES[sale.paymentStatus],
          )}
        >
          {PAYMENT_STATUS_LABELS[sale.paymentStatus]}
        </span>
      ),
    },
    {
      key: "soldBy",
      header: "Sold by",
      hideBelowMd: true,
      cell: (sale) => <MemberRef memberId={sale.soldBy} action="Recorded" />,
    },
    {
      key: "status",
      header: "Status",
      align: "end",
      cell: (sale) =>
        sale.status === "voided" ? (
          // The canvas's voided chip: no fill, a hairline and muted text, so a
          // reversal reads as an absence rather than as an alarm.
          <span className="inline-flex h-[22px] items-center rounded-lg border border-border-strong px-2 font-medium text-[11px] text-muted-foreground">
            {STATUS_LABELS.voided}
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">
            {STATUS_LABELS.completed}
          </span>
        ),
    },
  ];

  return (
    <DataTable
      caption="Sales"
      columns={columns}
      rows={rows}
      getRowId={(sale) => sale.id}
      isLoading={isLoading}
      isStale={isStale}
      emptyState={emptyState}
      onRowClick={(sale) => router.push(ROUTES.sale(sale.id))}
      pagination={meta ? { ...meta, onPageChange, onLimitChange } : undefined}
    />
  );
}

/**
 * The customer column, and the second thing this payload cannot name.
 *
 * `customerId` is a bare id too, and unlike the receipt — which resolves it
 * with one `GET /customers/:id` because it is one page about one sale — a list
 * would need one request per distinct customer on every page turn. That is the
 * cost `docs/findings/slice3-sales-data.md` argues against, so the column says
 * only what the row actually knows.
 *
 * **The absence is the information here.** A sale with no `customerId` is a
 * walk-in, which is a fact and is stated; a sale with one is a customer this
 * screen cannot name, which is an em dash with the id in its tooltip. The
 * receipt one click away has the name, the phone and the address.
 */
function CustomerRef({ customerId }: { customerId?: ObjectId }) {
  if (!customerId) {
    return <span className="text-[13px] text-muted-foreground">Walk-in</span>;
  }

  const description = `Customer ${customerId} — open the receipt for their name`;

  return (
    <span className="text-[13px] text-muted-foreground" title={description}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{description}</span>
    </span>
  );
}
