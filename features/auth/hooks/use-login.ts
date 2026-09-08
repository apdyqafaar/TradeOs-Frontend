"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { LoginInput } from "@/features/auth/schemas/auth.schema";
import type { LoginResult } from "@/features/auth/services/auth.service";
import { login } from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

export type { LoginResult } from "@/features/auth/services/auth.service";

/**
 * Step one of signing in.
 *
 * `data` is the discriminated union the API returns, so the form branches on
 * `data.twoFactorRequired`: `false` means a session cookie was set and the app
 * can navigate; `true` means no cookie exists yet and the 2FA screen needs
 * `data.challengeToken` for `POST /auth/2fa/challenge`. Sending the user to
 * the overview on a `true` would land them on a page that immediately 401s.
 */
export function useLogin(): UseMutationResult<
  LoginResult,
  ApiError,
  LoginInput
> {
  const queryClient = useQueryClient();

  return useMutation<LoginResult, ApiError, LoginInput>({
    mutationFn: login,
    onSuccess: (result) => {
      // No cookie was issued on the 2FA branch, so there is no new identity to
      // reset the cache for yet — that happens after the challenge succeeds.
      if (result.twoFactorRequired) return;
      // Whoever was signed in on this device before is not who is signed in
      // now. Anything still cached was fetched under their organization, so it
      // is discarded rather than invalidated.
      queryClient.clear();
    },
  });
}
