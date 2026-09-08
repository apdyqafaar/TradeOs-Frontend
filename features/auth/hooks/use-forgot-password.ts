"use client";

import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import type { ForgotPasswordInput } from "@/features/auth/schemas/auth.schema";
import { forgotPassword } from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/**
 * Asks for a password reset link.
 *
 * Nothing is invalidated on success because nothing the client holds changed:
 * the endpoint mints a token and mails it, and the caller is anonymous, so
 * there is no session, no organization and no cached query to refresh.
 *
 * `POST /auth/forgot-password` answers 200 whether or not the address has an
 * account (`Backend/src/services/auth.service.ts:474` — "Reporting 'no such
 * user' would turn this endpoint into a customer-enumeration oracle"). So a
 * success here is *not* evidence the address exists, and the UI it drives must
 * not phrase it as though it were. The one failure worth expecting is the
 * limiter: five requests per hour per bucket
 * (`Backend/src/routes/v1/auth.route.ts:64`), which arrives as a 429 the api
 * client already toasts.
 */
export function useForgotPassword(): UseMutationResult<
  void,
  ApiError,
  ForgotPasswordInput
> {
  return useMutation<void, ApiError, ForgotPasswordInput>({
    mutationFn: forgotPassword,
  });
}
