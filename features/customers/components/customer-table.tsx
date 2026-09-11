"use client";

import { cn } from "cn";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { ROUTES } from "@/config/routes";
import type { Customer, ListedCustomer } from "@/features/customers/types";
import type { PageMeta } from "@/lib/api/types";
import { formatMoney } from "@/lib/format/money";

const STATUS_STYLES: Record<Customer["status"], string> = {
  active: "bg-success-soft text-success-strong",
  archived: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<Customer["status"], string> = {
  active: "Active",
  archived: "Archived",
};

/** What a cell shows for an optional field the customer does not have. */
const ABSENT = "—";

interface CustomerTableProps {
  rows: ListedCustomer[];
  /** Absent until the first page has landed. */
  meta?: PageMeta;
  /**
   * The business's **main currency code**, from `useOrganization()`.
   *
   * Replaced `timezone` on 2026-09-11 when the Created column gave way to
   * Owes and Bought. Every figure in `stats` is a sum of `Debt.remaining` or
   * `Sale.total`, both stored in the main currency, so nothing here converts —
   * but it is still passed rather than assumed, because this market mixes
   * currencies whose symbols collide and the code is what disambiguates them
   * (`CLAUDE.md`: money is 2 dp with the currency CODE, never a symbol).
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
 * The customers table of artboard `2h`.
 *
 * Presentational, exactly like `<ProductTable>`: it is handed rows and hands
 * back page changes. The query lives one level up in `<CustomersPage>`, which
 * needs `meta.total` for the count beside the title and would otherwise have to
 * run it twice.
 *
 * **Owes and Bought are new, and this file used to argue they were
 * impossible.** It said there could be no money column at all: `GET /customers`
 * answered `publicCustomer`, nine fields and none of them money, so a balance
 * would have meant one extra request per row. That was true and is no longer —
 * every row now carries a `stats` object the server computes for the whole page
 * in one pass (2026-09-11). The reasoning was sound; the premise moved.
 *
 * They displaced **Address** and **Created**, which the canvas draws and which
 * nobody reads on a list whose purpose is now "who owes me, and who buys from
 * me". Both are still on the customer's own page.
 *
 * **No column header is clickable, and that is still deliberate.** The list IS
 * sortable now — `?sort=` takes `name`, `outstanding`, `overdue` and `sales` —
 * but the control for it lives in the filter bar, not on the headers. Only
 * three of these six columns can be sorted by, and headers that look alike
 * while three of them silently do nothing are worse than a control that lists
 * exactly what it offers. Sorting the 25 rows in memory remains the thing that
 * must never happen: it reorders one page of N and lies about the rest.
 */
export function CustomerTable({
  rows,
  meta,
  currency,
  isLoading,
  isStale,
  emptyState,
  onPageChange,
  onLimitChange,
}: CustomerTableProps) {
  const router = useRouter();

  const columns: DataTableColumn<ListedCustomer>[] = [
    {
      key: "name",
      header: "Name",
      cell: (customer) => (
        <span className="block truncate text-[13px] text-foreground">
          {customer.name}
        </span>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      // Mono, because a phone number is read digit by digit and compared
      // against the one on a receipt. It is also the field the API's
      // uniqueness index is built on, so it is the one a duplicate is about.
      cell: (customer) => (
        <span className="font-mono text-xs text-foreground">
          {customer.phone}
        </span>
      ),
    },
    {
      key: "email",
      header: "Email",
      hideBelowMd: true,
      cell: (customer) => (
        <span className="block truncate text-[13px] text-muted-foreground">
          {/* Absent, not null — the shaper omits the key entirely when the
              customer has no email, so `?? ABSENT` is the only branch needed. */}
          {customer.email ?? ABSENT}
        </span>
      ),
    },
    {
      key: "outstanding",
      header: "Owes",
      align: "end",
      /*
       * The number the "Owes the most" and "Most overdue" rankings sort by.
       * A sort by a figure the row does not show is not a usable screen —
       * the reader has to take the order on trust and cannot tell a leader
       * from a tie.
       *
       * The overdue part is called out rather than shown as a separate
       * column: what a shopkeeper needs at a glance is "how much, and is any
       * of it late", and two money columns side by side invites reading them
       * as a total.
       */
      cell: (customer) => {
        const { outstanding, overdueAmount, overdueCount } = customer.stats;
        if (outstanding === 0) {
          return <span className="text-[13px] text-muted-2">{ABSENT}</span>;
        }
        return (
          <span className="flex flex-col items-end gap-0.5">
            <span className="font-mono text-[13px] text-foreground">
              {formatMoney(outstanding, currency)}
            </span>
            {overdueCount > 0 ? (
              <span className="font-mono text-[11px] text-destructive-strong">
                {formatMoney(overdueAmount, currency)} overdue
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "salesTotal",
      header: "Bought",
      align: "end",
      hideBelowMd: true,
      /* What "Buys the most" ranks by. Completed sales only — a voided sale
         is not a sale, and counting one would make the best customer the one
         whose sales were reversed. */
      cell: (customer) =>
        customer.stats.salesCount === 0 ? (
          <span className="text-[13px] text-muted-2">{ABSENT}</span>
        ) : (
          <span className="flex flex-col items-end gap-0.5">
            <span className="font-mono text-[13px] text-foreground">
              {formatMoney(customer.stats.salesTotal, currency)}
            </span>
            <span className="font-mono text-[11px] text-muted-2">
              {customer.stats.salesCount}
              {customer.stats.salesCount === 1 ? " sale" : " sales"}
            </span>
          </span>
        ),
    },
    {
      key: "status",
      header: "Status",
      align: "end",
      cell: (customer) => (
        <span
          className={cn(
            "inline-flex h-[22px] items-center rounded-lg px-2 text-[11px] font-medium",
            STATUS_STYLES[customer.status],
          )}
        >
          {STATUS_LABELS[customer.status]}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption="Customers"
      columns={columns}
      rows={rows}
      getRowId={(customer) => customer.id}
      isLoading={isLoading}
      isStale={isStale}
      emptyState={emptyState}
      onRowClick={(customer) => router.push(ROUTES.customer(customer.id))}
      pagination={meta ? { ...meta, onPageChange, onLimitChange } : undefined}
    />
  );
}
