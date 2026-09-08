"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";
import { productKeys } from "../keys";
import * as productService from "../services/product.service";
import type { Product, ProductListParams } from "../types";

/**
 * `GET /products`, filtered and paged.
 *
 * `"use client"` is on every file in `hooks/` even though none of them is a
 * component: it turns an accidental import from a Server Component into a
 * clear build error instead of a stack trace inside React Query.
 *
 * `params` comes from the URL via `nuqs`, so two renders with the same filters
 * produce the same key and one request. It defaults to `{}` — an unfiltered
 * first page — rather than being required, because a list that is asked for
 * before its filters have resolved should still show the default page.
 *
 * No `retry` override: `lib/query/client.ts` already refuses to retry any 4xx,
 * and a second retry policy for the same query is how one of them silently
 * stops being true.
 */
export function useProducts(
  params: ProductListParams = {},
): UseQueryResult<Paginated<Product>, ApiError> {
  return useQuery<Paginated<Product>, ApiError>({
    queryKey: productKeys.list(params),
    queryFn: () => productService.list(params),
    // Page and filters are part of the key, so every page turn is a different
    // query — and without this the table would unmount its rows and flash a
    // skeleton on each one. `keepPreviousData` holds the previous page on
    // screen while the next loads and reports the gap through
    // `isPlaceholderData`, which the table dims on rather than blanking.
    placeholderData: keepPreviousData,
  });
}
