"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { customerKeys } from "@/features/customers/keys";
import * as customerService from "@/features/customers/services/customer.service";
import type { CustomerDetail } from "@/features/customers/types";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";

/**
 * One customer and what they owe.
 *
 * The result is a `CustomerDetail` — `{ customer, debtSummary }` — because the
 * endpoint answers both in one body. The service does the splitting; see the
 * note on `getById` for why the wire shape is flatter than this.
 *
 * `id` is optional so the hook can be called before a route param has
 * resolved. `enabled` keeps it from firing with an empty id, which would cache
 * a 404 under a key nothing will ever invalidate.
 *
 * No `retry` override: `lib/query/client.ts` already refuses to retry anything
 * under status 500, and a 404 for another business's id is an answer rather
 * than a blip. Restating the policy here is how one of the two copies silently
 * stops being true.
 */
export function useCustomer(
  id: ObjectId | undefined,
): UseQueryResult<CustomerDetail, ApiError> {
  return useQuery<CustomerDetail, ApiError>({
    // Only reached when `enabled` is true, so nothing is ever fetched under
    // the empty-string fallback.
    queryKey: customerKeys.detail(id ?? ""),
    queryFn: () => {
      // Narrowed, not cast. `id as ObjectId` compiles and lies; with `enabled`
      // above, reaching this line means a wiring mistake, which is a bug
      // rather than something to paper over.
      if (!id) throw new Error("Customer id is missing");
      return customerService.getById(id);
    },
    enabled: Boolean(id),
  });
}
