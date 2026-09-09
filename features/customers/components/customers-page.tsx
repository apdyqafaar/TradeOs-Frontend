"use client";

import { cn } from "cn";
import { Plus, Search, Users } from "lucide-react";
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { useCan } from "@/features/auth/hooks/use-permission";
import { CustomerFormSheet } from "@/features/customers/components/customer-form-sheet";
import { CustomerTable } from "@/features/customers/components/customer-table";
import { useCustomers } from "@/features/customers/hooks/use-customers";
import type { CustomerListParams } from "@/features/customers/types";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { PERMISSIONS } from "@/lib/auth/permissions";

const STATUS_FILTERS = ["active", "archived", "all"] as const;

const STATUS_LABELS: Record<(typeof STATUS_FILTERS)[number], string> = {
  active: "Active",
  archived: "Archived",
  all: "All statuses",
};

/**
 * Every filter on this page, in the URL — `CLAUDE.md` and brief §8.4: a
 * filtered list must survive a reload, a shared link and the back button, and
 * none of those work when the state lives in a store.
 *
 * Each parser carries a default, which is what keeps the URL clean: nuqs drops
 * a key whose value equals its default, so `/customers` with nothing filtered
 * has a bare query string and `?search=bakaara` says exactly what is on screen.
 *
 * `status` defaults to `"active"` because that is what `GET /customers` already
 * does server-side when the key is absent — matching it here keeps the select
 * showing the truth without ever writing `status=active` into the URL.
 *
 * There are no tabs. Artboard `2h` draws none, and the plan asks only for
 * `search` and `status`; archived customers are reachable through the status
 * select rather than through a second view of the same table.
 */
const CUSTOMER_FILTER_PARSERS = {
  search: parseAsString.withDefault(""),
  status: parseAsStringLiteral(STATUS_FILTERS).withDefault("active"),
  page: parseAsInteger.withDefault(1),
  limit: parseAsInteger.withDefault(25),
};

/**
 * The page's filter state, read and written through the query string.
 *
 * `history: "replace"` so a filter change does not stack one history entry per
 * keystroke, and `scroll: false` so committing a search does not throw the
 * reader back to the top of the table.
 */
function useCustomerFilters() {
  return useQueryStates(CUSTOMER_FILTER_PARSERS, {
    history: "replace",
    scroll: false,
  });
}

type CustomerFilters = ReturnType<typeof useCustomerFilters>[0];
type SetCustomerFilters = ReturnType<typeof useCustomerFilters>[1];

/**
 * URL state → `GET /customers` query, and the one place the two disagree.
 *
 * **`search` is dropped rather than sent empty.** `listCustomersQuerySchema` is
 * `.strict()` and its `search` is `z.string().trim().min(1).max(100)`, so
 * `?search=` is a 422 — on the normal, unfiltered state of this page. The key
 * goes instead.
 *
 * Doing it here rather than only in the service is not belt and braces: these
 * params are also the React Query key. `{ search: "" }` and `{}` hash to two
 * different keys for one identical request, which is two cache entries, two
 * loading states and a refetch every time the box is cleared.
 *
 * `status` is the opposite case and is always sent: it is a real enum value the
 * backend accepts, and sending it keeps the request self-describing.
 */
function toCustomerListParams(filters: CustomerFilters): CustomerListParams {
  const search = filters.search.trim();

  return {
    page: filters.page,
    limit: filters.limit,
    status: filters.status,
    ...(search === "" ? {} : { search }),
  };
}

/** True when something other than the page is narrowing the list. */
function hasActiveFilters(filters: CustomerFilters): boolean {
  return filters.search.trim() !== "" || filters.status !== "active";
}

/** Everything a "Clear filters" action resets, and nothing else. */
const CLEARED_FILTERS = {
  search: "",
  status: "active",
  page: 1,
} as const;

/**
 * How long the search box waits before the URL — and so the request — moves.
 *
 * Debounced here rather than through nuqs's own `limitUrlUpdates`, for the
 * reason `product-filters.tsx` records: nuqs applies a queued update to the
 * value it hands back immediately and only rate-limits the write to
 * `window.history`, so the URL would lag while the query key, and the request,
 * still fired on every keystroke.
 */
const SEARCH_DEBOUNCE_MS = 300;

const CONTROL =
  "h-[38px] rounded-[10px] border border-border bg-card text-[13px] text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * The customer book — artboard `2h`, and the plan's Task 8.
 *
 * One client component holding the URL filter state, because everything below
 * it reads the same filters: the bar writes `search` and `status`, the table
 * writes `page` and `limit`. A single `[filters, setFilters]` pair passed down
 * keeps one nuqs subscription and states "changing a filter resets the page" in
 * one place.
 */
export function CustomersPage() {
  const [filters, setFilters] = useCustomerFilters();
  const [sheetOpen, setSheetOpen] = useState(false);
  const canCreate = useCan(PERMISSIONS.CUSTOMERS_CREATE);

  /*
   * `timezone` for the Created column. `isLoading` covers the currency query
   * this screen never uses, which costs one extra beat of skeleton on a cold
   * deep link — accepted, because the alternative is rendering the first page
   * of dates in the `"UTC"` fallback and then shifting them once the session
   * lands, and a date that changes under the reader is worse than a skeleton
   * that lasts a moment longer.
   */
  const { timezone, isLoading: organizationLoading } = useOrganization();

  const customers = useCustomers(toCustomerListParams(filters));
  const { data, error, isPending, isPlaceholderData, refetch } = customers;

  const total = data?.meta.total;

  // A 403 is not a failure to retry: nothing broke, the caller simply may not
  // read this. `RouteGuard` already gates `/customers` on `customers:view`, so
  // arriving here means a custom role lost it between renders.
  if (error?.status === 403) {
    return <ForbiddenScreen />;
  }

  const filtered = hasActiveFilters(filters);
  const emptyState = filtered ? (
    <EmptyState
      title="No customers match these filters"
      description="Search matches the start of a name or a phone number, so try fewer characters — or a different status."
      icon={Users}
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
      title="No customers yet"
      description="Add the people and businesses this shop sells to, and they will show up here."
      icon={Users}
      action={
        canCreate ? (
          <Button onClick={() => setSheetOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New customer
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-[32px] leading-[1.1] text-foreground">
            Customers
          </h1>
          {total !== undefined ? (
            <span className="font-mono text-[13px] text-muted-foreground">
              {total}
            </span>
          ) : null}
        </div>

        {canCreate ? (
          <Button
            className="h-10 rounded-[10px] px-4 text-[13px]"
            onClick={() => setSheetOpen(true)}
          >
            <Plus className="size-4" aria-hidden="true" />
            New customer
          </Button>
        ) : null}
      </header>

      <CustomerFiltersBar filters={filters} setFilters={setFilters} />

      {error ? (
        <ErrorCard
          error={error}
          retry={() => {
            void refetch();
          }}
        />
      ) : null}

      {/*
        A failure with nothing cached renders the card and nothing else: an
        empty table under it would read as "this business has no customers"
        rather than "we could not ask". A failure *over* existing rows keeps
        them, because stale rows plus an honest card beat a blank screen.
      */}
      {error && !data ? null : (
        <CustomerTable
          rows={data?.items ?? []}
          meta={data?.meta}
          timezone={timezone}
          isLoading={isPending || organizationLoading}
          isStale={isPlaceholderData}
          emptyState={emptyState}
          onPageChange={(page) => void setFilters({ page })}
          onLimitChange={(limit) => void setFilters({ limit, page: 1 })}
        />
      )}

      {/*
        Rendered only for a caller who may create one, so the sheet's mutation
        hooks are not mounted for a Viewer who could never submit them.

        `onCreated` is deliberately not passed: `useCreateCustomer` has already
        invalidated every list, so the new row arrives on its own. The obvious
        alternative — pushing to the new customer's detail page — is left out
        because a shopkeeper adding four customers in a row wants to stay on
        this screen, and Slice 3's counter is the caller that actually needs the
        created row handed back.
      */}
      {canCreate ? (
        <CustomerFormSheet open={sheetOpen} onOpenChange={setSheetOpen} />
      ) : null}
    </div>
  );
}

interface CustomerFiltersProps {
  filters: CustomerFilters;
  setFilters: SetCustomerFilters;
}

/**
 * Search and status.
 *
 * Artboard `2h` draws neither — it shows the table straight under the title —
 * but the plan asks for both and brief §8.4 requires every list to be
 * filterable and to have a filtered-empty state to recover from. Two controls
 * in the products page's filter row, so the two screens read as siblings.
 *
 * Controlled from the URL by the page rather than owning its own copy, with one
 * exception: the text in the search box, which has to run ahead of the URL
 * while somebody is still typing.
 */
function CustomerFiltersBar({ filters, setFilters }: CustomerFiltersProps) {
  // What is in the box right now. The URL holds what has been *committed*.
  const [draft, setDraft] = useState(filters.search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Adopt a search value that arrived from somewhere other than this box — the
   * back button, or the filtered-empty state's "Clear filters" — so the box
   * never shows text that is no longer filtering anything. When the change came
   * from the debounce below, `filters.search` already equals `draft` and React
   * bails out of the re-render.
   */
  useEffect(() => {
    setDraft(filters.search);
  }, [filters.search]);

  // A pending keystroke must not land after the component is gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleSearch = (value: string) => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Back to page 1: page 7 of the old result is not page 7 of the new one.
      void setFilters({ search: value, page: 1 });
    }, SEARCH_DEBOUNCE_MS);
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div
        className={cn(
          CONTROL,
          "flex min-w-[220px] flex-1 items-center gap-2 px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        )}
      >
        <Search
          className="size-[15px] flex-none text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={draft}
          onChange={(event) => handleSearch(event.target.value)}
          placeholder="Search name or phone"
          /*
           * The placeholder says what it matches, not how. What it does *not*
           * say is the thing worth knowing: the backend matches a `^term`
           * prefix against the lower-cased name or the **normalised** phone, so
           * "wholesale" finds nothing for "Bakaara Wholesale" and a phone must
           * be typed without spaces or dashes. That is a property of the API,
           * and the filtered-empty state is where it gets explained.
           */
          aria-label="Search customers by name or phone"
          className="h-full w-full bg-transparent text-[13px] placeholder:text-muted-foreground focus-visible:outline-none"
        />
      </div>

      <label className="sr-only" htmlFor="customer-status-filter">
        Status
      </label>
      <select
        id="customer-status-filter"
        value={filters.status}
        onChange={(event) =>
          void setFilters({
            status: event.target.value as CustomerFilters["status"],
            page: 1,
          })
        }
        className={cn(CONTROL, "px-3")}
      >
        {STATUS_FILTERS.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>
    </div>
  );
}
