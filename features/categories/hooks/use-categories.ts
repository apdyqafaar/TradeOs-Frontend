"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { categoryKeys } from "@/features/categories/keys";
import { listCategories } from "@/features/categories/services/category.service";
import type { Category } from "@/features/categories/types";
import type { ApiError } from "@/lib/api/errors";

export type { Category } from "@/features/categories/types";

/**
 * Every category the organization has, in one query.
 *
 * **`Category[]`, not `Paginated<Category>`.** `GET /categories` returns the
 * whole set as a bare array with no `meta` — it is the one list endpoint in
 * this API that is not paginated, because the set is small and bounded by how
 * many labels a shop invents. Callers map it directly; there is no `.items`.
 *
 * `staleTime` is five minutes. Two screens read this — the Categories tab and
 * the product form's category select — and a category list changes when
 * someone deliberately edits it, which invalidates the key anyway. Refetching
 * it on every mount of a form would be a request that answers the same thing.
 */
export function useCategories(): UseQueryResult<Category[], ApiError> {
  return useQuery<Category[], ApiError>({
    queryKey: categoryKeys.list(),
    queryFn: listCategories,
    staleTime: 5 * 60_000,
  });
}
