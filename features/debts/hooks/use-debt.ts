"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { debtKeys } from "../keys";
import * as debtService from "../services/debt.service";
import type { Debt } from "../types";

/**
 * One debt.
 *
 * The result is a flat `Debt` and nothing else — the endpoint attaches no
 * payments, no customer and no totals, so a detail screen pairs this with
 * `useDebtPayments` and with `useCustomer(debt.customerId)` for a name.
 *
 * **Every overdue judgement on the screen comes from this response**, not from
 * arithmetic over `dueDate`: `isOverdue` and `daysOverdue` are recomputed by the
 * server on every read against its own clock, and a browser with a skewed clock
 * or a different idea of the business day would disagree with the list the row
 * came from.
 *
 * `id` is optional so the hook can be called before a route param has resolved.
 * `enabled` keeps it from firing with an empty id, which would cache a 404 under
 * a key nothing will ever invalidate.
 *
 * No `retry` override: `lib/query/client.ts` already refuses to retry anything
 * under status 500, and a 404 for another business's id is an answer rather than
 * a blip. Restating the policy here is how one of the two copies silently stops
 * being true.
 */
export function useDebt(
  id: ObjectId | undefined,
): UseQueryResult<Debt, ApiError> {
  return useQuery<Debt, ApiError>({
    // Only reached when `enabled` is true, so nothing is ever fetched under the
    // empty-string fallback.
    queryKey: debtKeys.detail(id ?? ""),
    queryFn: () => {
      // Narrowed, not cast. `id as ObjectId` compiles and lies; with `enabled`
      // above, reaching this line means a wiring mistake, which is a bug rather
      // than something to paper over.
      if (!id) throw new Error("Debt id is missing");
      return debtService.getById(id);
    },
    enabled: Boolean(id),
  });
}
