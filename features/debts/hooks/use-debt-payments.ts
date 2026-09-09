"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId, Paginated } from "@/lib/api/types";
import { debtKeys } from "../keys";
import * as debtService from "../services/debt.service";
import type { Payment, PaymentListParams } from "../types";

/**
 * `GET /debts/:id/payments` — a debt's repayment history, newest first.
 *
 * Pagination only. The endpoint offers no status filter and its query schema is
 * `.strict()`, so `?status=completed` is a 422 rather than a narrower list: a
 * "hide voided" control filters the fetched page in the component and must not
 * present itself as filtering the whole history, because `meta.total` keeps
 * counting the voided rows.
 *
 * A voided payment is still a row here, with `status: "voided"` and its
 * `voidedAt` / `voidReason` filled in. That is deliberate on the backend's part
 * — the trail is the point — so render them struck through rather than hiding
 * them by default, and never sum `amountMain` across the page to reconcile a
 * balance without excluding them.
 *
 * `debtId` is optional for the same reason `useDebt`'s is: the detail screen can
 * render before its route param resolves.
 */
export function useDebtPayments(
  debtId: ObjectId | undefined,
  params: PaymentListParams = {},
): UseQueryResult<Paginated<Payment>, ApiError> {
  return useQuery<Paginated<Payment>, ApiError>({
    queryKey: debtKeys.paymentList(debtId ?? "", params),
    queryFn: () => {
      if (!debtId) throw new Error("Debt id is missing");
      return debtService.listPayments(debtId, params);
    },
    enabled: Boolean(debtId),
    // Paging the history should not blank the table under the cursor.
    placeholderData: keepPreviousData,
  });
}
