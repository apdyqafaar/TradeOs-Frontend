"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { saleKeys } from "@/features/sales/keys";
import * as saleService from "@/features/sales/services/sale.service";
import type { Sale, SaleListParams } from "@/features/sales/types";
import type { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";

/**
 * The sales journal, paginated and filtered.
 *
 * `"use client"` is here even though this is not a component: it turns an
 * accidental import from a Server Component into a clear build error instead of
 * a stack trace inside React Query.
 *
 * `GET /sales` answers `{ data, meta }` — **not** a bare array, unlike
 * `GET /categories` — so this returns a `Paginated<Sale>` and the footer has a
 * real `total` and `totalPages` to render. Reusing the categories list shape
 * here would silently drop pagination (`docs/contracts/sales.md` trap 1).
 *
 * Nothing here shows an error. A failure belongs to the component that caused
 * it — the inline error card with the request id (brief §8.4) — and a toast
 * fired from `onError` would swallow it before the screen ever hears about it.
 */
export function useSales(
  params: SaleListParams = {},
): UseQueryResult<Paginated<Sale>, ApiError> {
  return useQuery<Paginated<Sale>, ApiError>({
    queryKey: saleKeys.list(params),
    queryFn: () => saleService.list(params),
    // Page and filters are part of the key, so every page turn and every filter
    // change is a different query — without this the table unmounts its rows and
    // flashes a skeleton on each one. `keepPreviousData` holds the previous rows
    // on screen and reports the gap through `isPlaceholderData`, which the table
    // dims on rather than blanking.
    placeholderData: keepPreviousData,
  });
}
