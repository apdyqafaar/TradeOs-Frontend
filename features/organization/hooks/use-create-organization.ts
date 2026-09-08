"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authKeys } from "@/features/auth/keys";
import { organizationKeys } from "@/features/organization/keys";
import type { CreateOrganizationInput } from "@/features/organization/schemas/organization.schema";
import { createOrganization } from "@/features/organization/services/organization.service";
import type { CreateOrganizationResult } from "@/features/organization/types";
import type { ApiError } from "@/lib/api/errors";

/**
 * Creates the caller's business — the step between registering and having an
 * app to use.
 *
 * The response carries three things, not one (`createOrganizationHandler` in
 * `Backend/src/controller/organization.controller.ts`): the organization, its
 * currency configuration, and the Owner role with its permission list. All
 * three are worth keeping, which is why the mutation's data type is
 * `CreateOrganizationResult` rather than `Organization`.
 */
export function useCreateOrganization(): UseMutationResult<
  CreateOrganizationResult,
  ApiError,
  CreateOrganizationInput
> {
  const queryClient = useQueryClient();

  return useMutation<
    CreateOrganizationResult,
    ApiError,
    CreateOrganizationInput
  >({
    mutationFn: createOrganization,
    onSuccess: (result) => {
      // The currency arrived in this response, so seeding it means the first
      // screen after onboarding can format money without a round trip — and
      // `useOrganization` reads exactly this key.
      queryClient.setQueryData(organizationKeys.currency(), result.currency);
      queryClient.setQueryData(organizationKeys.current(), result.organization);

      // `GET /auth/me` answered `organization: null, role: null,
      // permissions: []` a moment ago and now answers with all three. Nothing
      // in the shell — the sidebar, every permission gate — is correct until
      // it is refetched.
      //
      // `authKeys.session()` with the call parentheses: the keys in
      // `features/auth/keys.ts` are functions, and passing the function itself
      // matches no query and fails silently.
      void queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}
