"use client";

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { authKeys } from "@/features/auth/keys";
import {
  type DeviceSession,
  listDeviceSessions,
  logoutAll,
  logoutOthers,
} from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/**
 * `GET /auth/sessions` and the two revocations that exist.
 *
 * ## There is no per-session revoke, and this is where that is felt
 *
 * The whole API contains four session-shaped routes: `GET /auth/sessions`,
 * `POST /auth/logout`, `POST /auth/logout-all` and `POST /auth/logout-others`.
 * There is **no `DELETE /auth/sessions/:id`** — confirmed by exhaustive grep
 * over `Backend/src/routes/` (`docs/contracts/settings-account.md` §6) — and
 * `session.actions.ts` exports nothing reachable with a client-supplied session
 * id. `deleteSessionById` exists and is used only by `/logout`, for the
 * caller's *own* session.
 *
 * So the `id` on each row is a field with no consumer, and this file
 * deliberately exposes no `revoke(id)`. The list is read-only and the two
 * buttons below are the entire vocabulary. Adding a per-row control would mean
 * inventing a request the server answers 404 to.
 *
 * The gaps that follow from the same place, and shape `components/sessions-panel.tsx`:
 * **no device/browser/OS parsing** (the raw `userAgent` string, unparsed, or
 * `null`), and **no "last active"** — `expiresAt` is the only forward-moving
 * timestamp and it advances at most once a day
 * (`session.service.ts:68-75`), so it cannot be rendered as "active 4 minutes
 * ago" without lying.
 */

/**
 * Every session on the account, newest first, exactly one flagged
 * `isCurrent`.
 *
 * Six keys per row and no more (`session.service.ts:115-123`); the API's own
 * test refuses anything 32-hex-shaped anywhere in the body, so no truncated
 * token hash can reach the client (`account.test.ts:107-140`).
 *
 * `staleTime: 0` — the point of this list is that it is current. It is also the
 * screen a person opens *because* they suspect something, and a cached answer
 * from four minutes ago is exactly the wrong thing to show them.
 */
export function useDeviceSessions(): UseQueryResult<DeviceSession[], ApiError> {
  return useQuery<DeviceSession[], ApiError>({
    queryKey: authKeys.sessions(),
    queryFn: async () => (await listDeviceSessions()).sessions,
    staleTime: 0,
  });
}

/**
 * `POST /auth/logout-others` — **no body**, and the route's `noBodySchema`
 * makes `{ anything: 1 }` a 422 rather than a silent no-op
 * (`account.test.ts:228-238`). The service sends nothing.
 *
 * Answers `{ revokedSessions: number }` and **deliberately does not clear the
 * caller's cookie** (`auth.controller.ts:165-175`), proven by replaying a
 * captured header for the other device (401) against a live `/auth/me` for the
 * caller (200) at `account.test.ts:180-206`. So this must not sign the user
 * out or redirect; the panel shows the count and refetches the list.
 */
export function useLogoutOthers(): UseMutationResult<
  { revokedSessions: number },
  ApiError,
  void
> {
  const queryClient = useQueryClient();

  return useMutation<{ revokedSessions: number }, ApiError, void>({
    mutationFn: logoutOthers,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.sessions() });
    },
  });
}

/**
 * `POST /auth/logout-all` — ends **every** session **including this one**, and
 * clears the cookie (`auth.controller.ts:83-88`). The user is signed out.
 *
 * `clear()` on settled rather than invalidate, and for the reason `useLogout`
 * spells out: this is a tenant boundary on a shared back-office machine, and an
 * invalidated query still renders its previous data while the refetch is in
 * flight. Everything cached was fetched as somebody who is no longer signed in.
 */
export function useLogoutEverywhere(): UseMutationResult<void, ApiError, void> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, void>({
    mutationFn: logoutAll,
    onSettled: () => {
      queryClient.clear();
    },
  });
}
