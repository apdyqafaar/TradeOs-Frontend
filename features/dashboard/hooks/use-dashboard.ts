"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { dashboardKeys } from "@/features/dashboard/keys";
import { getDashboard } from "@/features/dashboard/services/dashboard.service";
import type {
  DashboardResponse,
  DashboardSectionKey,
  DashboardSections,
} from "@/features/dashboard/types";
import type { ApiError } from "@/lib/api/errors";

export type {
  DashboardResponse,
  DashboardSectionKey,
  DashboardSections,
} from "@/features/dashboard/types";

/**
 * The Overview's one query.
 *
 * `staleTime` is a minute: the Overview is a glance at the business, not a
 * live board, and the server recomputes every section from scratch on each
 * call — ten aggregates for an Owner. A shorter window would re-run all of
 * them every time someone navigates back to the home screen.
 */
export function useDashboard(): UseQueryResult<DashboardResponse, ApiError> {
  return useQuery<DashboardResponse, ApiError>({
    queryKey: dashboardKeys.overview(),
    queryFn: getDashboard,
    staleTime: 60_000,
  });
}

/**
 * One section, or `undefined`.
 *
 * "Not allowed to see it" and "not loaded yet" are deliberately the same
 * answer: a section a Seller will never receive is not an error to render, it
 * is simply not part of their page. Callers that need to tell the two apart
 * read `isPending` off `useDashboard()`.
 *
 * Calling this beside `useDashboard()` costs nothing — both read the same query
 * key, so React Query serves one request to every subscriber.
 */
export function useDashboardSection<K extends DashboardSectionKey>(
  key: K,
): DashboardSections[K] | undefined {
  const { data } = useDashboard();
  return data?.sections[key];
}
