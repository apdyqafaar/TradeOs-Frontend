"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { logout } from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/**
 * Ends the current session and empties the cache.
 *
 * `clear()` rather than `invalidateQueries` because this is a tenant boundary,
 * not a freshness problem. A shop's back-office laptop is shared: the next
 * person to sign in may belong to a different business entirely, and an
 * invalidated query still holds its previous data and renders it while the
 * refetch is in flight. That would show one business's customers and sale
 * totals to another. Discarding is the only correct behaviour.
 *
 * On `onSettled`, not `onSuccess`: if the call fails because the session had
 * already been revoked elsewhere, the local cache is stale for exactly the
 * same reason and must go anyway.
 */
export function useLogout(): UseMutationResult<void, ApiError, void> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, void>({
    mutationFn: logout,
    onSettled: () => {
      queryClient.clear();
    },
  });
}
