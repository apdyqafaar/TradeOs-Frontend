"use client";

import { cn } from "cn";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { ROUTES } from "@/config/routes";
import type { Customer } from "@/features/customers/types";
import type { PageMeta } from "@/lib/api/types";
import { formatDate } from "@/lib/format/date";

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
  rows: Customer[];
  /** Absent until the first page has landed. */
  meta?: PageMeta;
  /**
   * The **business's** IANA zone, from `useOrganization()`. `createdAt` is an
   * ISO string and `formatDate` takes the zone as a required argument for the
   * reason `CLAUDE.md` gives: a customer added at 23:30 in Nairobi belongs to
   * that day for the shop even when the owner is reading the list from London.
   */
  timezone: string;
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
 * **There is no balance column, and there must not be one.** `GET /customers`
 * answers `publicCustomer`, which is nine fields and none of them is money —
 * the debt figures come from `GET /customers/:id`, whose `debtSummary` is
 * computed per customer by an aggregate. A balance column here would mean one
 * extra request per row, and the only number available to fake it with
 * (`totalRemaining`) is not on the wire at all. The canvas agrees: Name, Phone,
 * Email, Address, Created, Status.
 *
 * **No column is sortable.** `listCustomersQuerySchema` is `.strict()` and
 * accepts `page`, `limit`, `search` and `status` — there is no `sort` key, so
 * `<DataTable>`'s sorting props are deliberately not passed. Sorting the 25
 * rows in memory would silently reorder one page of N and lie about the rest.
 */
export function CustomerTable({
  rows,
  meta,
  timezone,
  isLoading,
  isStale,
  emptyState,
  onPageChange,
  onLimitChange,
}: CustomerTableProps) {
  const router = useRouter();

  const columns: DataTableColumn<Customer>[] = [
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
      key: "address",
      header: "Address",
      hideBelowMd: true,
      cell: (customer) => (
        <span className="block truncate text-[13px] text-muted-foreground">
          {customer.address ?? ABSENT}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      hideBelowMd: true,
      cell: (customer) => (
        <span className="font-mono text-xs text-muted-foreground">
          {formatDate(customer.createdAt, timezone)}
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
