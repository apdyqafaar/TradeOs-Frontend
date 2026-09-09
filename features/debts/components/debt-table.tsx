"use client";

import { cn } from "cn";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { ROUTES } from "@/config/routes";
import type { Debt, DebtStatus } from "@/features/debts/types";
import type { PageMeta } from "@/lib/api/types";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";

/**
 * The four **stored** statuses, and the whole of them.
 *
 * `Record<DebtStatus, string>`, so a fifth key does not compile — in particular
 * `overdue`, which is not a status a debt can hold. The palette is the one
 * `debt-detail.tsx` already established for this slice, duplicated rather than
 * imported because that file is the detail screen's and exports neither map;
 * the two are kept side by side deliberately so a row and the page it opens
 * never disagree about what colour a written-off debt is.
 */
const STATUS_STYLES: Record<DebtStatus, string> = {
  open: "bg-muted text-muted-foreground",
  // A write-off is a loss the business should be able to spot in a list, but it
  // is not an error — amber, not red.
  written_off: "bg-warning-soft text-warning-strong",
  paid: "bg-success-soft text-success-strong",
  // Nothing happened and nothing is owed: the quietest tone there is.
  cancelled: "bg-muted text-muted-2",
};

const STATUS_LABELS: Record<DebtStatus, string> = {
  open: "Open",
  paid: "Paid",
  written_off: "Written off",
  cancelled: "Cancelled",
};

/**
 * The overdue pill, which is **not** a member of the two maps above.
 *
 * It is rendered from `debt.isOverdue`, a field the server recomputes on every
 * single response as `status === "open" && dueDate < now && remaining > 0`
 * against its own clock. `debt.status === "overdue"` would not compile, and a
 * browser comparing `dueDate` to `Date.now()` would disagree with the API by a
 * day either side of midnight in whichever zone the reader happens to be in.
 */
const OVERDUE_STYLE = "bg-destructive-soft text-destructive-strong";

interface DebtTableProps {
  rows: Debt[];
  /** Absent until the first page has landed. */
  meta?: PageMeta;
  /**
   * The business's main currency **code**, from `useOrganization()`.
   *
   * Required rather than defaulted, and never a symbol: **a `Debt` carries no
   * `currency` field at all** (`../Backend/src/db/models/debt.model.ts` has
   * none), so `principal`, `paid` and `remaining` are implicitly in the
   * organization's main currency and there is nothing on the row to read it
   * from. A hardcoded `"USD"` would label a Kenyan shop's ledger with the wrong
   * code and look entirely correct doing it.
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
 * The debts table of artboard `2f`
 * (`docs/design/TradeOs-UI.dc.html:838-871`) — Customer, Source, Principal,
 * Paid, Remaining, Due, Status.
 *
 * Presentational, like `<SaleTable>` and `<CustomerTable>`: it is handed rows
 * and hands back page changes. The query lives one level up in `<DebtsPage>`,
 * which needs `meta.total` for the count beside the title and would otherwise
 * have to run it twice.
 *
 * **Every number is printed exactly as the server sent it.** `remaining` is a
 * stored column mutated only by guarded atomic updates — not `principal -
 * paid` — and `isOverdue` / `daysOverdue` are computed fresh on every response.
 * The settlement tolerance (`remaining <= 0.004` forces `status: "paid"` and
 * `remaining` to exactly `0`) and the payment overshoot tolerance are
 * server-internal and never on the wire, so any arithmetic here can disagree
 * with the API by a cent on the one screen whose subject is what people owe.
 *
 * **No column is sortable, and none may become one.** `listDebtsQuerySchema` is
 * `.strict()` and has no `sort` key — the order is a *side effect of the status
 * filter*: `open` and `overdue` sort `{ dueDate: 1, _id: 1 }`, every other
 * value sorts `{ createdAt: -1, _id: -1 }` (`debt.actions.ts:178-183`). So
 * `<DataTable>`'s sorting props are deliberately not passed, and there is no
 * fixed "Due date ↓" indicator on the header: it would be wrong on four of the
 * six tabs, and saying nothing beats saying something false.
 */
export function DebtTable({
  rows,
  meta,
  currency,
  timezone,
  isLoading,
  isStale,
  emptyState,
  onPageChange,
  onLimitChange,
}: DebtTableProps) {
  const router = useRouter();

  const columns: DataTableColumn<Debt>[] = [
    {
      key: "customer",
      header: "Customer",
      cell: (debt) => <CustomerCell debt={debt} />,
    },
    {
      key: "source",
      header: "Source",
      hideBelowMd: true,
      cell: (debt) => <SourceCell debt={debt} />,
    },
    {
      key: "principal",
      header: "Principal",
      align: "end",
      hideBelowMd: true,
      cell: (debt) => (
        <span className="font-mono text-[13px] text-muted-foreground">
          {formatMoney(debt.principal, currency)}
        </span>
      ),
    },
    {
      key: "paid",
      header: "Paid",
      align: "end",
      hideBelowMd: true,
      cell: (debt) => (
        <span className="font-mono text-[13px] text-muted-foreground">
          {formatMoney(debt.paid, currency)}
        </span>
      ),
    },
    {
      key: "remaining",
      header: "Remaining",
      align: "end",
      cell: (debt) => (
        // The one figure the table exists to answer, so it is the only amount
        // drawn at full weight — same emphasis the summary card gives it.
        <span className="font-medium font-mono text-[13px] text-foreground">
          {formatMoney(debt.remaining, currency)}
        </span>
      ),
    },
    {
      key: "dueDate",
      header: "Due",
      align: "end",
      cell: (debt) => (
        <span className="inline-flex items-center justify-end gap-[7px]">
          <span className="font-mono text-[12px] text-muted-foreground">
            {formatDate(debt.dueDate, timezone)}
          </span>
          {/*
            The canvas's small red pill. Gated on `isOverdue`, never on
            `daysOverdue > 0`: the API sends exactly `0` whenever `isOverdue` is
            false, so a `0` means "not overdue", not "due today".
          */}
          {debt.isOverdue ? (
            <span
              className={cn(
                "inline-flex h-5 items-center rounded-md px-1.5 font-medium font-mono text-[10px]",
                OVERDUE_STYLE,
              )}
            >
              {debt.daysOverdue} d<span className="sr-only"> overdue</span>
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "end",
      cell: (debt) => <StatusCell debt={debt} />,
    },
  ];

  return (
    <DataTable
      caption="Debts"
      columns={columns}
      rows={rows}
      getRowId={(debt) => debt.id}
      isLoading={isLoading}
      isStale={isStale}
      emptyState={emptyState}
      onRowClick={(debt) => router.push(ROUTES.debt(debt.id))}
      pagination={meta ? { ...meta, onPageChange, onLimitChange } : undefined}
    />
  );
}

/**
 * The customer's name over their phone — the column this whole screen was
 * blocked on.
 *
 * `GET /debts` used to answer a bare `customerId`, which made this cell
 * impossible without one request per row. The owner ruled that the server
 * should resolve it, and `Backend` `a117e5e` added `customer` to **this
 * endpoint only** (`docs/FINDINGS.md` §1). The single-debt responses still send
 * a bare id, which is why `Debt.customer` is optional in the first place.
 *
 * **The key is absent, never blank, when the server could not resolve one** —
 * `publicDebt` spreads `...(customer ? { customer } : {})`
 * (`../Backend/src/controller/debt.controller.ts:37-40`), and the lookup behind
 * it is tenant-filtered, so a debt pointing at another organization's customer
 * resolves to nothing rather than leaking a name. That is the case this branch
 * exists for: it means the customer row is gone from *this* business's book,
 * not that they have no name. Rendering `customer?.name ?? ""` would put an
 * empty cell there that reads as a nameless customer; the id is printed instead
 * so somebody can paste it into a support ticket.
 */
function CustomerCell({ debt }: { debt: Debt }) {
  if (!debt.customer) {
    const description = `Customer ${debt.customerId} is not in this business's customer book`;

    return (
      <span className="flex min-w-0 flex-col" title={description}>
        <span aria-hidden="true" className="truncate text-[13px] text-muted-2">
          Unknown customer
        </span>
        <span aria-hidden="true" className="font-mono text-[11px] text-muted-2">
          …{debt.customerId.slice(-6)}
        </span>
        {/* A bare `span` has no role, so it cannot carry an accessible name;
            the full sentence is read out instead of the truncated id. */}
        <span className="sr-only">{description}</span>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-[13px] text-foreground">
        {debt.customer.name}
      </span>
      {/* Mono, because a phone number is read digit by digit and compared with
          the one on a receipt — and on a collections screen it is the thing
          somebody is about to dial. */}
      <span className="truncate font-mono text-[11px] text-muted-2">
        {debt.customer.phone}
      </span>
    </span>
  );
}

/**
 * Where the debt came from, and what it was for.
 *
 * A sale-born debt carries a `saleId`; the canvas draws it as a link to the
 * receipt and `/sales/[id]` does not exist, so this is text with the full id in
 * its `title` — the call `debt-detail.tsx` and `stock-movements-table.tsx` both
 * already made. The id is shortened because a debt carries the sale's ObjectId
 * and not its receipt number: nothing in this payload knows what the counter
 * printed.
 *
 * `description` is appended on the same line rather than given a column of its
 * own, which is what the artboard's single truncating 1.4fr cell has room for.
 * It is absent rather than null when unset — the model only requires it for
 * manual debts — so the separator has to be conditional.
 */
function SourceCell({ debt }: { debt: Debt }) {
  const fromSale = debt.source === "sale" && debt.saleId !== undefined;
  const origin = fromSale ? `Sale …${debt.saleId?.slice(-6)}` : "Manual";
  const fullOrigin = fromSale ? `Sale ${debt.saleId}` : "Manual debt";
  const suffix = debt.description ? ` · ${debt.description}` : "";

  return (
    <span
      className="block truncate text-[12px] text-muted-foreground"
      title={`${fullOrigin}${suffix}`}
    >
      {origin}
      {suffix}
    </span>
  );
}

/**
 * One pill, carrying both halves of the status model.
 *
 * An overdue debt is stored as `open` — there is no fifth enum member — so a
 * table that printed `STATUS_LABELS[debt.status]` alone would show a column of
 * identical "Open" pills on the screen whose job is to pick out who to chase.
 * The label is therefore taken from `isOverdue` **first** and from the stored
 * `status` otherwise, which is the composition the type system allows:
 * `isOverdue` is a boolean the server computed, not a status value.
 *
 * This is the one place this slice differs from `debt-detail.tsx`, which has
 * room to draw the stored pill and an overdue badge side by side. A table cell
 * has one slot, and the days pill in the Due column already carries the
 * magnitude.
 */
function StatusCell({ debt }: { debt: Debt }) {
  const isOverdue = debt.isOverdue;

  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center rounded-lg px-2 font-medium text-[11px]",
        isOverdue ? OVERDUE_STYLE : STATUS_STYLES[debt.status],
      )}
    >
      {isOverdue ? "Overdue" : STATUS_LABELS[debt.status]}
    </span>
  );
}
