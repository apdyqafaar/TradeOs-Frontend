"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { customerKeys } from "@/features/customers/keys";
import * as customerService from "@/features/customers/services/customer.service";
import type { Customer, CustomerListParams } from "@/features/customers/types";
import type { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";

/**
 * The customer book, paginated and filtered.
 *
 * `"use client"` is here even though this is not a component: it turns an
 * accidental import from a Server Component into a clear build error instead
 * of a stack trace inside React Query.
 *
 * Nothing here shows an error. A failure belongs to the component that caused
 * it — the inline error card with the request id (brief §8.4) — and a toast
 * fired from `onError` would swallow it before the screen ever hears about it.
 *
 * **This hook has a second caller from Slice 3**: the counter's customer
 * picker searches with it. Keep `params` the endpoint's own query and nothing
 * more, so a picker can pass `{ search, limit: 10 }` without inheriting a
 * list-screen assumption.
 */
export function useCustomers(
  params: CustomerListParams = {},
): UseQueryResult<Paginated<Customer>, ApiError> {
  return useQuery<Paginated<Customer>, ApiError>({
    queryKey: customerKeys.list(params),
    queryFn: () => customerService.list(params),
    // Page and filters are part of the key, so every page turn and every
    // keystroke of a search is a different query — without this the table
    // would unmount its rows and flash a skeleton on each one. `keepPreviousData`
    // holds the previous rows on screen while the next answer loads and reports
    // the gap through `isPlaceholderData`, which the table dims on rather than
    // blanking. It is what makes the counter's picker usable while typing.
    placeholderData: keepPreviousData,
  });
}
