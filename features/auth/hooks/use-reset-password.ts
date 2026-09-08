"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { ResetPasswordInput } from "@/features/auth/schemas/auth.schema";
import { resetPassword } from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/**
 * Spends a reset token and sets a new password.
 *
 * `clear()`, not `invalidateQueries`. The endpoint revokes **every** session on
 * the account — the caller's included — because a reset is the canonical "I may
 * have been compromised" action (`Backend/src/services/auth.service.ts:533`).
 * So a browser that was signed in a moment ago is signed out now, and anything
 * still cached was read as an identity that no longer has a cookie. Invalidating
 * would keep that data on screen while the refetch 401s.
 */
export function useResetPassword(): UseMutationResult<
  void,
  ApiError,
  ResetPasswordInput
> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, ResetPasswordInput>({
    mutationFn: resetPassword,
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
