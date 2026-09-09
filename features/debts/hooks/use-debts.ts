"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";
import { debtKeys } from "../keys";
import * as debtService from "../services/debt.service";
import type { Debt, DebtListParams } from "../types";

/**
 * The debt book, paginated and filtered.
 *
 * `"use client"` is here even though this is not a component: it turns an
 * accidental import from a Server Component into a clear build error instead of
 * a stack trace inside React Query.
 *
 * Nothing here shows an error. A failure belongs to the component that caused it
 * — the inline error card with the request id (brief §8.4) — and a toast fired
 * from `onError` would swallow it before the screen ever hears about it.
 *
 * **Calling this with no params is not "all debts".** The API defaults `status`
 * to `"open"`, so an unfiltered call is the open-debts worklist. That is usually
 * the right default for a collections screen and exactly the wrong one for a
 * customer's history panel, which wants `{ customerId, status: "all" }`.
 */
export function useDebts(
  params: DebtListParams = {},
): UseQueryResult<Paginated<Debt>, ApiError> {
  return useQuery<Paginated<Debt>, ApiError>({
    queryKey: debtKeys.list(params),
    queryFn: () => debtService.list(params),
    // Page and filters are part of the key, so every page turn and every filter
    // change is a different query — without this the table would unmount its
    // rows and flash a skeleton on each one. `keepPreviousData` holds the
    // previous rows on screen while the next answer loads and reports the gap
    // through `isPlaceholderData`, which the table dims on rather than blanking.
    placeholderData: keepPreviousData,
  });
}
