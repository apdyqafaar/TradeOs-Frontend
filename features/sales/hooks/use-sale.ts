"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { saleKeys } from "@/features/sales/keys";
import * as saleService from "@/features/sales/services/sale.service";
import type { Sale } from "@/features/sales/types";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";

/**
 * One sale — the receipt.
 *
 * `id` is optional so the hook can be called before a route param has resolved.
 * `enabled` keeps it from firing with an empty id, which would cache a failure
 * under a key nothing will ever invalidate.
 *
 * **Two different failures mean "no such receipt" here**, and only one of them
 * is a 404. A well-formed id that resolves to nothing — including one belonging
 * to another business — is a 404 `NOT_FOUND`; anything that is not 24 hex
 * characters fails `idParamSchema` in the middleware chain and is a **422**
 * before the handler runs. A detail screen keyed only on 404 shows a red error
 * card to someone who mistyped the URL.
 *
 * No `retry` override: `lib/query/client.ts` already refuses to retry anything
 * under status 500, and both failures above are answers rather than blips.
 * Restating the policy here is how one of the two copies stops being true.
 */
export function useSale(
  id: ObjectId | undefined,
): UseQueryResult<Sale, ApiError> {
  return useQuery<Sale, ApiError>({
    // Only reached when `enabled` is true, so nothing is ever fetched under the
    // empty-string fallback.
    queryKey: saleKeys.detail(id ?? ""),
    queryFn: () => {
      // Narrowed, not cast. `id as ObjectId` compiles and lies; with `enabled`
      // above, reaching this line means a wiring mistake, which is a bug rather
      // than something to paper over.
      if (!id) throw new Error("Sale id is missing");
      return saleService.getById(id);
    },
    enabled: Boolean(id),
  });
}
