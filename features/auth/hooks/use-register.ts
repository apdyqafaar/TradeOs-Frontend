"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { RegisterInput } from "@/features/auth/schemas/auth.schema";
import type { SessionUser } from "@/features/auth/services/auth.service";
import { register } from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/**
 * Creates a person, not a business.
 *
 * The response carries the user and nothing else: no organization, no role, no
 * permissions. Registration issues a session cookie, so the next screen is
 * "create your business" (`POST /organizations`), and `useSession` will report
 * `organization: null` until that second step completes. It also mails a
 * verification link — creating a business and inviting staff are gated on it.
 */
export function useRegister(): UseMutationResult<
  { user: SessionUser },
  ApiError,
  RegisterInput
> {
  const queryClient = useQueryClient();

  return useMutation<{ user: SessionUser }, ApiError, RegisterInput>({
    mutationFn: register,
    onSuccess: () => {
      // A cookie for a brand-new identity just landed; nothing cached under
      // whoever used this browser before applies to it.
      queryClient.clear();
    },
  });
}
