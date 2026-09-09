"use client";

import { cn } from "cn";
import { Search } from "lucide-react";
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { useEffect, useRef, useState } from "react";
import { useCategories } from "@/features/categories/hooks/use-categories";
import type { ProductListParams } from "@/features/products/types";

/**
 * The three tabs this page actually has.
 *
 * Artboard `2c` draws a fourth, **Import**. The import wizard is its own slice
 * (the plan's "Explicitly out of scope"), and `/products/import` has no page,
 * so the tab is dropped rather than rendered as something that navigates
 * nowhere — a dead tab is worse than an honest absence. The **Import** button
 * in the title row survives, disabled, because a button can say "Coming soon"
 * about itself where a tab cannot.
 */
export const PRODUCT_TABS = ["all", "low", "categories"] as const;
export type ProductTab = (typeof PRODUCT_TABS)[number];

const STATUS_FILTERS = ["active", "archived", "all"] as const;

const STATUS_LABELS: Record<(typeof STATUS_FILTERS)[number], string> = {
  active: "Active",
  archived: "Archived",
  all: "All statuses",
};

/**
 * Every filter on this page, in the URL — brief §8.4 and `CLAUDE.md`: a
 * filtered list must survive a page reload, a shared link and the back button,
 * and none of those work when the state lives in a store.
 *
 * Every parser carries a default, which is what makes the URL clean: nuqs
 * drops a key whose value equals its default (`clearOnDefault`, on by
 * default), so `/products` with nothing filtered has a bare query string, and
 * `?search=rice` says exactly what is on screen.
 *
 * `status` defaults to `"active"` because that is what `GET /products` already
 * does server-side when the key is absent. Matching it here keeps the select
 * showing the truth (artboard `2c` draws the chip reading "Active") without
 * ever putting `status=active` in the URL.
 *
 * There is no `lowStock` key: the **Low stock** tab *is* that filter, so
 * storing it twice would let `?tab=all&lowStock=true` exist and mean nothing.
 */
const PRODUCT_FILTER_PARSERS = {
  tab: parseAsStringLiteral(PRODUCT_TABS).withDefault("all"),
  search: parseAsString.withDefault(""),
  categoryId: parseAsString.withDefault(""),
  status: parseAsStringLiteral(STATUS_FILTERS).withDefault("active"),
  page: parseAsInteger.withDefault(1),
  limit: parseAsInteger.withDefault(25),
};

/**
 * The page's filter state, read and written through the query string.
 *
 * `history: "replace"` so a filter change does not stack a history entry per
 * keystroke; the tab switcher passes `{ history: "push" }` at its call site,
 * because moving between All and Low stock *is* a navigation a person expects
 * the back button to undo.
 */
export function useProductFilters() {
  return useQueryStates(PRODUCT_FILTER_PARSERS, {
    history: "replace",
    scroll: false,
  });
}

export type ProductFilters = ReturnType<typeof useProductFilters>[0];
export type SetProductFilters = ReturnType<typeof useProductFilters>[1];

/**
 * URL state → `GET /products` query, and the only place the two disagree.
 *
 * Three keys are **dropped rather than sent empty**, because
 * `listProductsQuerySchema` is `.strict()` and every one of these is a 422
 * rather than an ignored filter:
 *
 *   - `search` is `min(1)`. An empty search box is the normal state of this
 *     page, and `?search=` would fail the whole request — so the key goes.
 *   - `categoryId` is an ObjectId; `""` is not one.
 *   - `lowStock` is `z.enum(["true"])`, so it is the string `"true"` or it is
 *     absent. There is no way to say "not low", and `false` is not one.
 *
 * `product.service.ts` already drops `search: ""` and `lowStock: false` on the
 * way to the wire, so this is belt and braces there — but it is not redundant
 * *here*, because these params are also the React Query key. `{ search: "" }`
 * and `{}` hash to two different keys for one identical request, which is two
 * cache entries, two loading states and a refetch every time the box is
 * cleared.
 */
export function toProductListParams(
  filters: ProductFilters,
): ProductListParams {
  const search = filters.search.trim();

  return {
    page: filters.page,
    limit: filters.limit,
    status: filters.status,
    ...(search === "" ? {} : { search }),
    ...(filters.categoryId === "" ? {} : { categoryId: filters.categoryId }),
    ...(filters.tab === "low" ? { lowStock: true } : {}),
  };
}

/** True when something other than the tab and the page is narrowing the list. */
export function hasActiveFilters(filters: ProductFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.categoryId !== "" ||
    filters.status !== "active"
  );
}

/** Everything a "Clear filters" action resets, and nothing else. */
export const CLEARED_FILTERS = {
  search: "",
  categoryId: "",
  status: "active",
  page: 1,
} as const;

/**
 * How long the search box waits before the URL — and therefore the request —
 * moves.
 *
 * 300ms is the usual compromise, but the reason it has to be done *here* and
 * not with nuqs's own `limitUrlUpdates: debounce(300)` is worth knowing: nuqs
 * applies a queued update to the value it hands back **immediately** and only
 * rate-limits the write to `window.history` (`queuedQueries` in
 * `nuqs/dist/index.js`). The URL would lag; the query key, and so the request,
 * would still fire on every keystroke. Debouncing the input instead is what
 * actually spares the API.
 */
const SEARCH_DEBOUNCE_MS = 300;

const CONTROL =
  "h-[38px] rounded-[10px] border border-border bg-card text-[13px] text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

interface ProductFiltersProps {
  filters: ProductFilters;
  setFilters: SetProductFilters;
}

/**
 * The filter row of artboard `2c`: search, category, status.
 *
 * Controlled from the URL by the page rather than owning its own copy, with
 * one exception — the text in the search box, which has to be able to run
 * ahead of the URL while someone is still typing.
 */
export function ProductFiltersBar({
  filters,
  setFilters,
}: ProductFiltersProps) {
  const categories = useCategories();

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
          placeholder="Search name or barcode"
          aria-label="Search products by name or barcode"
          className="h-full w-full bg-transparent text-[13px] placeholder:text-muted-foreground focus-visible:outline-none"
        />
      </div>

      {/* `GET /categories` is gated on `categories:view`. Every preset role
          holds it, but a custom role need not — and a filter the caller cannot
          populate is dropped rather than shown disabled, per `CLAUDE.md`: a
          user without a permission sees nothing, not a dead control. */}
      {categories.error ? null : (
        <>
          <label className="sr-only" htmlFor="product-category-filter">
            Category
          </label>
          <select
            id="product-category-filter"
            value={filters.categoryId}
            disabled={categories.isPending}
            onChange={(event) =>
              void setFilters({ categoryId: event.target.value, page: 1 })
            }
            className={cn(CONTROL, "px-3 disabled:opacity-50")}
          >
            <option value="">All categories</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </>
      )}

      <label className="sr-only" htmlFor="product-status-filter">
        Status
      </label>
      <select
        id="product-status-filter"
        value={filters.status}
        onChange={(event) =>
          void setFilters({
            status: event.target.value as ProductFilters["status"],
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
