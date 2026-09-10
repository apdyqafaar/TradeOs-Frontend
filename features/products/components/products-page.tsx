"use client";

import { cn } from "cn";
import { Package, Plus } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { CategoryTab } from "@/features/categories/components/category-tab";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import {
  CLEARED_FILTERS,
  hasActiveFilters,
  ProductFiltersBar,
  type ProductTab,
  type SetProductFilters,
  toProductListParams,
  useProductFilters,
} from "@/features/products/components/product-filters";
import { ProductTable } from "@/features/products/components/product-table";
import { useProducts } from "@/features/products/hooks/use-products";
import type { ProductListParams } from "@/features/products/types";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * The count on the **Low stock** tab, as artboard `2c` draws it.
 *
 * A separate one-row query rather than a number pulled off the list, because
 * the alarm has to read the same on every tab and under every filter: a search
 * for "rice" must not make the shop look like it has one low product. `limit:
 * 1` because only `meta.total` is used; the row itself is thrown away.
 *
 * Module-level and frozen, so it is one cache entry for the whole session
 * instead of a new object identity — and so a new query key — on every render.
 */
const LOW_STOCK_COUNT_PARAMS: ProductListParams = Object.freeze({
  lowStock: true,
  status: "active",
  limit: 1,
});

const TAB_LABELS: Record<ProductTab, string> = {
  all: "All",
  low: "Low stock",
  categories: "Categories",
};

/**
 * The products list — artboard `2c`, and the plan's Task 5.
 *
 * One client component holding the URL filter state, because every piece below
 * it reads the same filters: the tabs write `tab`, the filter bar writes
 * `search`/`categoryId`/`status`, and the table writes `page`/`limit`. Passing
 * one `[filters, setFilters]` pair down keeps a single nuqs subscription and
 * makes "changing a filter resets the page" a rule stated in one place.
 */
export function ProductsPage() {
  const [filters, setFilters] = useProductFilters();
  const canCreate = useCan(PERMISSIONS.PRODUCTS_CREATE);
  const canViewCategories = useCan(PERMISSIONS.CATEGORIES_VIEW);
  const { currency, isLoading: organizationLoading } = useOrganization();

  /**
   * The Categories tab has no list, so a caller who deep-links to it fetches
   * one page of products it will not draw. That is deliberate: the key is
   * identical to the All tab's, so it is one request that warms the tab they
   * are about to click, and the alternative — moving `useProducts` inside
   * `<ProductTable>` — would cost the count beside the title a second copy of
   * the same query.
   */
  const products = useProducts(toProductListParams(filters));
  const lowStock = useProducts(LOW_STOCK_COUNT_PARAMS);

  const tabs: ProductTab[] = canViewCategories
    ? ["all", "low", "categories"]
    : ["all", "low"];

  // A tab the caller may not see must not stay selected from a stale URL.
  const activeTab: ProductTab = tabs.includes(filters.tab)
    ? filters.tab
    : "all";

  const lowStockCount = lowStock.data?.meta.total ?? 0;
  const total = products.data?.meta.total;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-[32px] leading-[1.1] text-foreground">
            Products
          </h1>
          {activeTab !== "categories" && total !== undefined ? (
            <span className="font-mono text-[13px] text-muted-foreground">
              {total}
            </span>
          ) : null}
        </div>

        {canCreate ? (
          <div className="flex flex-wrap items-center gap-2.5">
            {/*
              The import wizard (artboard `2e`) now exists. It is inside this
              `canCreate` block rather than carrying a gate of its own because
              it needs the same permission: all ten `/products/import`
              endpoints gate on `products:create` and there is no separate
              import permission (`docs/contracts/product-import.md` §0).
            */}
            <Button
              variant="outline"
              className="h-10 rounded-[10px] px-4 text-[13px]"
              render={<Link href={ROUTES.productImport} />}
            >
              Import
            </Button>

            <Button
              className="h-10 rounded-[10px] px-4 text-[13px]"
              render={<Link href={ROUTES.productNew} />}
            >
              <Plus className="size-4" aria-hidden="true" />
              New product
            </Button>
          </div>
        ) : null}
      </header>

      <div
        role="tablist"
        aria-label="Products views"
        className="flex gap-6 border-b border-border"
      >
        {tabs.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`products-tab-${tab}`}
              aria-selected={isActive}
              aria-controls={`products-panel-${tab}`}
              onClick={() =>
                // `push`, not the hook's default `replace`: moving between
                // All and Low stock is a navigation the back button should
                // undo. `page: 1` because page 4 of All is not page 4 of Low.
                void setFilters({ tab, page: 1 }, { history: "push" })
              }
              className={cn(
                "-mb-px border-b-2 px-0.5 pb-[11px] text-[13px] transition-colors",
                isActive
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABELS[tab]}
              {tab === "low" && lowStockCount > 0 ? (
                <span className="ml-1.5 font-mono text-[11px] text-warning-strong">
                  {lowStockCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`products-panel-${activeTab}`}
        aria-labelledby={`products-tab-${activeTab}`}
        className="flex flex-col gap-5"
      >
        {activeTab === "categories" ? (
          <CategoryTab />
        ) : (
          <ProductList
            filters={filters}
            setFilters={setFilters}
            currency={currency}
            organizationLoading={organizationLoading}
            products={products}
            canCreate={canCreate}
          />
        )}
      </div>
    </div>
  );
}

interface ProductListProps {
  filters: ReturnType<typeof useProductFilters>[0];
  setFilters: SetProductFilters;
  currency: string;
  organizationLoading: boolean;
  products: ReturnType<typeof useProducts>;
  canCreate: boolean;
}

/**
 * The filter bar plus the table, and the five list states that can reach this
 * page (brief §8.4).
 *
 * The sixth state in the brief — a domain 409 shown where the action was
 * taken — has nothing to attach to here: this screen only reads. Archiving,
 * `DUPLICATE_BARCODE` and `INSUFFICIENT_STOCK` all belong to the form and the
 * detail page.
 */
function ProductList({
  filters,
  setFilters,
  currency,
  organizationLoading,
  products,
  canCreate,
}: ProductListProps) {
  const { data, error, isPending, isPlaceholderData, refetch } = products;

  // A 403 is not a failure to retry: nothing broke, the caller simply may not
  // read this. `RouteGuard` already gates `/products` on `products:view`, so
  // arriving here means a custom role lost it between renders.
  if (error?.status === 403) {
    return <ForbiddenScreen />;
  }

  const filtered = hasActiveFilters(filters);
  const emptyState =
    filters.tab === "low" && !filtered ? (
      <EmptyState
        title="Nothing is running low"
        description="A product appears here once it drops to or below the low-stock threshold set on it."
        icon={Package}
      />
    ) : filtered ? (
      <EmptyState
        title="No products match these filters"
        description="Try a different search, category or status."
        icon={Package}
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
        title="No products yet"
        description="Add what this business sells and it will show up here, with its stock and its price."
        icon={Package}
        action={
          canCreate ? (
            <Button render={<Link href={ROUTES.productNew} />}>
              <Plus className="size-4" aria-hidden="true" />
              New product
            </Button>
          ) : undefined
        }
      />
    );

  return (
    <>
      <ProductFiltersBar filters={filters} setFilters={setFilters} />

      {error ? (
        <ErrorCard
          error={error}
          retry={() => {
            void refetch();
          }}
        />
      ) : null}

      {error && !data ? (
        // Nothing to show under the card, and an empty table would read as
        // "this business has no products" rather than "we could not ask".
        <DataTable
          caption="Products"
          columns={[]}
          rows={[]}
          getRowId={() => ""}
        />
      ) : (
        <ProductTable
          rows={data?.items ?? []}
          meta={data?.meta}
          currency={currency}
          // The currency is part of every money cell, so rows must not land
          // before it does — a bare `12.40` that gains a code a beat later
          // reads as a bug.
          isLoading={isPending || organizationLoading}
          isStale={isPlaceholderData}
          emptyState={emptyState}
          onPageChange={(page) => void setFilters({ page })}
          onLimitChange={(limit) => void setFilters({ limit, page: 1 })}
        />
      )}
    </>
  );
}
