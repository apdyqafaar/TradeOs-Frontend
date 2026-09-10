"use client";

import { HandCoins, Plus } from "lucide-react";
import { ButtonLink } from "@/components/shared/button-link";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import {
  DEBT_STATUS_LABELS,
  DebtStatusTabs,
  debtTabId,
  toDebtListParams,
  useDebtFilters,
} from "@/features/debts/components/debt-status-tabs";
import { DebtTable } from "@/features/debts/components/debt-table";
import { useDebts } from "@/features/debts/hooks/use-debts";
import type { DebtStatusFilter } from "@/features/debts/types";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { PERMISSIONS } from "@/lib/auth/permissions";

/** The one panel the six tabs control, so they can point `aria-controls` at it. */
const PANEL_ID = "debt-list-panel";

/**
 * The count beside the title, said in words that name the filter it counts.
 *
 * `meta.total` counts the rows matching the **current** `?status=`, not the
 * debt book — so "12" alone beside a tab strip is ambiguous and, on this
 * artboard, sits exactly where a money figure is drawn. "12 overdue" cannot be
 * misread as either.
 */
function countLabel(total: number, status: DebtStatusFilter): string {
  if (status === "all") return total === 1 ? "1 debt" : `${total} debts`;
  return `${total} ${DEBT_STATUS_LABELS[status].toLowerCase()}`;
}

/**
 * The debts list — artboard `2f` (`docs/design/TradeOs-UI.dc.html:816-874`).
 *
 * One client component holding the URL filter state, because everything below
 * it reads the same filters: the tabs write `status`, the table writes `page`
 * and `limit`. A single `[filters, setFilters]` pair passed down keeps one nuqs
 * subscription and states "changing a filter resets the page" in one place.
 *
 * Five of the six list states brief §8.4 requires reach this screen: loading,
 * empty, filtered-empty, an error card with the request id, and a 403. The
 * sixth — a domain 409 shown where the action was taken — has nothing to attach
 * to, because this screen only reads; `DEBT_NOT_OPEN` and
 * `PAYMENT_EXCEEDS_BALANCE` belong to the detail screen's dialogs.
 *
 * **There is no search box and no sortable column.** `listDebtsQuerySchema` is
 * `.strict()` with no `search` and no `sort` key; the ordering is a side effect
 * of the status filter. Both absences are argued where they bite — the filter
 * parsers in `debt-status-tabs.tsx` and the column list in `debt-table.tsx`.
 *
 * **And there is no outstanding total, which the artboard draws beside the
 * title.** The figure it wants is a sum of `remaining` over every open debt in
 * the business, and this endpoint does not carry it: the response is a page of
 * rows plus `{ page, limit, total, totalPages }`, where `total` is a row
 * *count*. Adding up the 25 rows on screen and labelling the result
 * "outstanding" would print a number that shrinks as you page through the list,
 * on a screen about money owed. The real figure exists elsewhere —
 * `GET /dashboard`'s `debts.outstanding` (gated on `debts:view`, the same
 * permission as this page) and `GET /reports/debts/summary` (`reports:view`),
 * both fed by the one `getDebtsSummary` aggregate — so it is deliverable, at
 * the cost of a second request that recomputes the whole Overview. That trade
 * is recorded in `docs/findings/slice3-debts-data.md` rather than taken here.
 */
export function DebtsPage() {
  const [filters, setFilters] = useDebtFilters();
  const canCreate = useCan(PERMISSIONS.DEBTS_CREATE);

  /*
   * Both facts are needed by the table: `currency` for the three money columns
   * and `timezone` for the Due column. Neither has a safe default — a Debt
   * carries no currency field at all — so the rows are held back until they
   * land. An amount that gains a code, or a due date that shifts a day, a beat
   * after the row appears reads as a bug on a ledger.
   */
  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();

  const { data, error, isPending, isPlaceholderData, refetch } = useDebts(
    toDebtListParams(filters),
  );

  const total = data?.meta.total;

  // A 403 is not a failure to retry: nothing broke, the caller simply may not
  // read this. `RouteGuard` already gates `/debts` on `debts:view`, so arriving
  // here means a custom role lost it between renders.
  if (error?.status === 403) {
    return <ForbiddenScreen />;
  }

  /*
   * "Filtered" means a tab other than the default. `open` is what the server
   * answers when `status` is absent, so it is the unfiltered view of a
   * collections screen; `all` is the widest possible filter, so an empty `all`
   * is not something a "show me open debts" action can rescue — it means the
   * book is empty.
   */
  const isNarrowed = filters.status !== "open" && filters.status !== "all";

  const emptyState = isNarrowed ? (
    <EmptyState
      title={`No ${DEBT_STATUS_LABELS[filters.status].toLowerCase()} debts`}
      description="Nothing in the book matches this tab right now."
      icon={HandCoins}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void setFilters({ status: "open", page: 1 })}
        >
          Show open debts
        </Button>
      }
    />
  ) : (
    <EmptyState
      title={filters.status === "all" ? "No debts yet" : "No open debts"}
      description={
        filters.status === "all"
          ? "Credit sales and hand-entered debts both land here, with what is still owed on each."
          : "Nothing is owed to this business right now. A debt raised at the counter or by hand shows up here."
      }
      icon={HandCoins}
      // The panel this codebase left actionless while there was no create
      // screen — noted as an anomaly in `docs/findings/slice3-debts-data.md`,
      // because every other empty state offers the create control to whoever
      // holds the permission. An empty debt book is the one place somebody is
      // most likely to want this.
      action={
        canCreate ? (
          <ButtonLink href={ROUTES.debtNew}>
            <Plus className="size-4" aria-hidden="true" />
            New debt
          </ButtonLink>
        ) : undefined
      }
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-[32px] text-foreground leading-[1.1]">
            Debts
          </h1>
          {total !== undefined ? (
            <span className="font-mono text-[13px] text-muted-foreground">
              {countLabel(total, filters.status)}
            </span>
          ) : null}
        </div>

        {/*
          The artboard's action, now that `app/(app)/debts/new/page.tsx` exists
          and `config/routes.ts` carries the row that gates it.

          **Hidden, never disabled** (brief §1.1): a member without
          `debts:create` — the Seller preset, which holds `debts:view` and
          `payments:create` but not this — does not learn that hand-entering a
          debt is a thing this product does. `useCan` rather than
          `<PermissionGate>` because that component renders nothing while the
          session loads, which would pop the button in after the heading has
          settled.

          `ROUTE_PERMISSIONS` gates `/debts/new` on the same permission, so a
          typed URL meets `RouteGuard` rather than a form that can only 403.
        */}
        {canCreate ? (
          <ButtonLink
            className="h-10 rounded-[10px] px-4 text-[13px]"
            href={ROUTES.debtNew}
          >
            <Plus className="size-4" aria-hidden="true" />
            New debt
          </ButtonLink>
        ) : null}
      </header>

      <DebtStatusTabs
        status={filters.status}
        // Back to page 1: page 7 of the open debts is not page 7 of the paid
        // ones, and the two lists are not even sorted the same way.
        onStatusChange={(status) => void setFilters({ status, page: 1 })}
        panelId={PANEL_ID}
      />

      {error ? (
        <ErrorCard
          error={error}
          title="Couldn't load the debts"
          retry={() => {
            void refetch();
          }}
        />
      ) : null}

      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={debtTabId(filters.status)}
      >
        {/*
          A failure with nothing cached renders the card alone: an empty table
          under it would read as "nobody owes this business anything" rather
          than "we could not ask" — the most expensive way to be wrong on this
          screen. A failure *over* existing rows keeps them, because stale rows
          plus an honest card beat a blank page.
        */}
        {error && !data ? null : (
          <DebtTable
            rows={data?.items ?? []}
            meta={data?.meta}
            currency={currency}
            timezone={timezone}
            isLoading={isPending || organizationLoading}
            isStale={isPlaceholderData}
            emptyState={emptyState}
            onPageChange={(page) => void setFilters({ page })}
            onLimitChange={(limit) => void setFilters({ limit, page: 1 })}
          />
        )}
      </div>
    </div>
  );
}
