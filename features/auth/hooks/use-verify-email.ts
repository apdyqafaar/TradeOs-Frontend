"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authKeys } from "@/features/auth/keys";
import type { VerifyEmailInput } from "@/features/auth/schemas/auth.schema";
import { verifyEmail } from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/**
 * Confirms an email address from the link in the mailbox.
 *
 * Public: the token *is* the credential, so the person clicking the link does
 * not have to be signed in on the device that opens it
 * (`Backend/src/services/auth.service.ts:594`). That is why this hook does not
 * assume a session — `invalidateQueries` on a key nothing has fetched is a
 * no-op, and on the laptop that registered it is exactly what clears the
 * unverified-email strip without a reload.
 *
 * `authKeys.session()` is **called**. The keys in `features/auth/keys.ts` are
 * functions, and passing the function itself matches nothing at all, silently.
 *
 * Every terminal failure — expired, already spent, mistyped, or issued for a
 * user who has since been deleted — is one 400 with `code: "BAD_REQUEST"` and
 * the message "This link is invalid or has expired". There is no distinct code
 * for "expired", by design: telling the two apart would tell a caller something
 * about a token they do not hold.
 */
export function useVerifyEmail(): UseMutationResult<
  void,
  ApiError,
  VerifyEmailInput
> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, VerifyEmailInput>({
    mutationFn: verifyEmail,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}
