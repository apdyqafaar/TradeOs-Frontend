"use client";

import { Plus, Receipt } from "lucide-react";
import { ButtonLink } from "@/components/shared/button-link";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import {
  CLEARED_FILTERS,
  hasActiveFilters,
  isPeriodError,
  SaleFiltersBar,
  toSaleListParams,
  useSaleFilters,
} from "@/features/sales/components/sale-filters";
import { SaleTable } from "@/features/sales/components/sale-table";
import { useSales } from "@/features/sales/hooks/use-sales";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * The sales journal — brief §6.4's list.
 *
 * One client component holding the URL filter state, because everything below
 * it reads the same filters: the bar writes `period`/`from`/`to`/
 * `paymentStatus`/`status`, the table writes `page`/`limit`. A single
 * `[filters, setFilters]` pair passed down keeps one nuqs subscription and
 * states "changing a filter resets the page" in one place.
 *
 * The five list states brief §8.4 requires all reach this screen: loading,
 * empty, filtered-empty, an error card with the request id, and a 403. The
 * sixth — a domain 409 shown where the action was taken — has nothing to
 * attach to here, because this screen only reads; `SALE_ALREADY_VOIDED` and
 * `DEBT_HAS_PAYMENTS` belong to the receipt's void dialog.
 */
export function SalesPage() {
  const [filters, setFilters] = useSaleFilters();
  const canCreate = useCan(PERMISSIONS.SALES_CREATE);

  /*
   * Both facts are needed by the table: `currency` for the Total column and
   * `timezone` for the When column. Neither has a safe default, so the rows
   * are held back until they land — a total that gains a currency code, or a
   * timestamp that shifts a day, a beat after the row appears reads as a bug.
   */
  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();

  const sales = useSales(toSaleListParams(filters));
  const { data, error, isPending, isPlaceholderData, refetch } = sales;

  const total = data?.meta.total;

  // A 403 is not a failure to retry: nothing broke, the caller simply may not
  // read this. `RouteGuard` already gates `/sales` on `sales:view`, so arriving
  // here means a custom role lost it between renders.
  if (error?.status === 403) {
    return <ForbiddenScreen />;
  }

  /*
   * The three 400s `GET /sales` can answer for a date range, which the client
   * guard in `rangeIssue` normally prevents — a hand-typed or shared URL is
   * the way one still arrives. Retrying is pointless (the answer will not
   * change), so the card carries no retry and the recovery is to drop the
   * range. `docs/contracts/sales.md`, Corrections §2.
   */
  const periodRefused = error !== null && isPeriodError(error);

  const filtered = hasActiveFilters(filters);
  const emptyState = filtered ? (
    <EmptyState
      title="No sales match these filters"
      description="Try a wider date range, a different payment status, or include voided sales."
      icon={Receipt}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void setFilters(CLEARED_FILTERS)}
        >
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      title="No sales yet"
      description="Every sale rung up at the counter lands here, with what was sold and what is still owed."
      icon={Receipt}
      action={
        canCreate ? (
          <ButtonLink href={ROUTES.newSale}>
            <Plus className="size-4" aria-hidden="true" />
            New sale
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
            Sales
          </h1>
          {total !== undefined ? (
            <span className="font-mono text-[13px] text-muted-foreground">
              {total}
            </span>
          ) : null}
        </div>

        {canCreate ? (
          <ButtonLink
            className="h-10 rounded-[10px] px-4 text-[13px]"
            href={ROUTES.newSale}
          >
            <Plus className="size-4" aria-hidden="true" />
            New sale
          </ButtonLink>
        ) : null}
      </header>

      <SaleFiltersBar filters={filters} setFilters={setFilters} />

      {error ? (
        <div className="flex flex-col items-start gap-2.5">
          <ErrorCard
            error={error}
            title={
              periodRefused
                ? "This date range can't be used"
                : "Couldn't load the sales"
            }
            retry={
              periodRefused
                ? undefined
                : () => {
                    void refetch();
                  }
            }
            className="w-full"
          />
          {periodRefused ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setFilters(CLEARED_FILTERS)}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}

      {/*
        A failure with nothing cached renders the card alone: an empty table
        under it would read as "this business has no sales" rather than "we
        could not ask". A failure *over* existing rows keeps them, because
        stale rows plus an honest card beat a blank screen.
      */}
      {error && !data ? null : (
        <SaleTable
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
  );
}
