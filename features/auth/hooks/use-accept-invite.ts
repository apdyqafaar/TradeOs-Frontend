"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { AcceptInviteInput } from "@/features/auth/schemas/auth.schema";
import type { SessionUser } from "@/features/auth/services/auth.service";
import { acceptInvite } from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/**
 * Accepts an emailed invitation — the only public endpoint that both creates a
 * person and signs them in.
 *
 * `POST /auth/accept-invite` sets the session cookie itself
 * (`Backend/src/controller/auth.controller.ts:114`), so there is no second
 * login step: the caller is a signed-in member of the inviting business the
 * moment this resolves, and the form can push straight to the overview.
 *
 * The cache is cleared rather than invalidated for the same reason `useLogin`
 * clears it: whoever used this browser before is not who is signed in now, and
 * everything cached was fetched under their organization. An invitee is also
 * the likeliest person to be borrowing a shared device.
 */
export function useAcceptInvite(): UseMutationResult<
  { user: SessionUser },
  ApiError,
  AcceptInviteInput
> {
  const queryClient = useQueryClient();

  return useMutation<{ user: SessionUser }, ApiError, AcceptInviteInput>({
    mutationFn: acceptInvite,
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
