"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { authKeys } from "@/features/auth/keys";
import type { SessionData } from "@/features/auth/services/auth.service";
import { getSession } from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

export type {
  SessionData,
  SessionUser,
} from "@/features/auth/services/auth.service";

/**
 * Who the caller is, which business they are in, and what they may do.
 *
 * Everything permission-shaped in the app reads from this one query, so the
 * shell, the nav, every gate and every disabled button agree by construction.
 */
export function useSession(): UseQueryResult<SessionData, ApiError> {
  return useQuery<SessionData, ApiError>({
    queryKey: authKeys.session(),
    queryFn: getSession,
    // The API re-reads the user, membership and role on every request, so this
    // cache only decides how often the *shell* redraws. Five minutes keeps a
    // navigation-heavy session from re-fetching identity on every route change;
    // a role change still takes effect immediately on the calls that matter,
    // because the API enforces it there.
    staleTime: 5 * 60_000,
    // A 401 here is the signed-out state, which is an answer, not a failure —
    // retrying it twice more only delays the login screen the client's 401
    // handler is already navigating to.
    retry: false,
  });
}
