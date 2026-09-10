"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authKeys } from "@/features/auth/keys";
import { organizationKeys } from "@/features/organization/keys";
import type {
  UpdateCurrencyInput,
  UpdateOrganizationInput,
} from "@/features/organization/schemas/organization.schema";
import {
  updateCurrencyConfig,
  updateOrganization,
} from "@/features/organization/services/organization.service";
import type {
  CurrencyConfig,
  Organization,
} from "@/features/organization/types";
import type { ApiError } from "@/lib/api/errors";

/**
 * The two Settings writes.
 *
 * Neither shows an error: the refusals are field-specific (a name collision
 * belongs on the name input, an equal-codes rejection on the second currency)
 * so the forms branch on them and render them where the person was typing.
 *
 * Both seed the cache from the response rather than only invalidating it. Each
 * PATCH answers with the **whole** public shape, so `setQueryData` is exact,
 * and a form that then re-reads its own key sees what the server stored — the
 * trimmed name, the uppercased code — instead of what was typed.
 */

/**
 * `PATCH /organizations/current`.
 *
 * The session is invalidated as well, and it has to be: `GET /auth/me` carries
 * its own copy of `organization.name` and `organization.timezone`, which the
 * sidebar renders and which every `formatDate` call in the app takes its zone
 * from. Leaving it stale means renaming a business updates this form and
 * nothing else on screen, and changing the timezone leaves every date in the
 * product on the old one until the five-minute session cache expires.
 */
export function useUpdateOrganization(): UseMutationResult<
  Organization,
  ApiError,
  UpdateOrganizationInput
> {
  const queryClient = useQueryClient();

  return useMutation<Organization, ApiError, UpdateOrganizationInput>({
    mutationFn: updateOrganization,
    onSuccess: (organization) => {
      queryClient.setQueryData(organizationKeys.current(), organization);
      queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}

/**
 * `PATCH /organizations/current/currency`.
 *
 * Invalidating `organizationKeys.currency()` reaches further than this screen:
 * it is the key `useOrganization` and `useCurrencyConfig` share, so the code
 * every `formatMoney` call in the app prints and the rate the counter converts
 * with both change at the same moment. Those two hooks cache for half an hour
 * precisely because this mutation exists to invalidate them.
 *
 * **It does not touch anything already recorded.** Every sale, payment and
 * debt stores the rate it was written at (`sale.model.ts:24`,
 * `payment.model.ts:14`), so a new rate prices new records only — which is
 * what the form says on screen, because it is the question every owner asks
 * before pressing save.
 */
export function useUpdateCurrencyConfig(): UseMutationResult<
  CurrencyConfig,
  ApiError,
  UpdateCurrencyInput
> {
  const queryClient = useQueryClient();

  return useMutation<CurrencyConfig, ApiError, UpdateCurrencyInput>({
    mutationFn: updateCurrencyConfig,
    onSuccess: (currency) => {
      queryClient.setQueryData(organizationKeys.currency(), currency);
    },
  });
}
