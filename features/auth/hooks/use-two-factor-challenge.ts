"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authKeys } from "@/features/auth/keys";
import type { TwoFactorChallengeInput } from "@/features/auth/schemas/auth.schema";
import type { SessionUser } from "@/features/auth/services/auth.service";
import { twoFactorChallenge } from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/**
 * The pending challenge, as `POST /auth/login` hands it back.
 *
 * `POST /auth/login` sets **no cookie** on the two-factor branch
 * (`Backend/src/controller/auth.controller.ts:57-66`) — the challenge token
 * exists only in that JSON body, and `/login/2fa` is a separate document with
 * no way to read it. So step one has to park it somewhere step two can find
 * it, and `sessionStorage` is that somewhere: same tab, gone when the tab
 * closes, never sent to a server, and invisible to another origin.
 *
 * It is deliberately not a query parameter. A `?challenge=` lands in the
 * browser history, in the `Referer` of anything the page loads, and in any
 * proxy log between here and the CDN — for a credential that is one correct
 * six-digit guess away from a session.
 */
export interface PendingTwoFactorChallenge {
  challengeToken: string;
  /** ISO-8601. The API allows five minutes (`two-factor.service.ts:47`). */
  expiresAt: string;
}

const STORAGE_KEY = "tradeos:two-factor-challenge";

/**
 * Called by the login form on the `twoFactorRequired: true` branch, before it
 * navigates to `/login/2fa`. Without this call the challenge token is dropped
 * and the 2FA screen can only tell the user to sign in again.
 */
export function rememberTwoFactorChallenge(
  challenge: PendingTwoFactorChallenge,
): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(challenge));
  } catch {
    // Storage can be unavailable — Safari private mode, blocked site data, an
    // embedded webview. The 2FA screen finds nothing and says "sign in again",
    // which is wrong but survivable; throwing here would break the login form
    // after a request that already succeeded.
  }
}

/** Returns the parked challenge, expired or not. Callers check `expiresAt`. */
export function readTwoFactorChallenge(): PendingTwoFactorChallenge | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { challengeToken, expiresAt } = parsed as Record<string, unknown>;
    if (typeof challengeToken !== "string" || challengeToken.length === 0) {
      return null;
    }
    if (typeof expiresAt !== "string") return null;

    return { challengeToken, expiresAt };
  } catch {
    // Unreadable storage or a half-written entry. Either way there is no
    // usable challenge, which is the same answer as "there is none".
    return null;
  }
}

export function forgetTwoFactorChallenge(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the entry is scoped to this tab and dies with it.
  }
}

/**
 * Step two of signing in: trades the challenge token for a session cookie.
 *
 * Public by design — the caller holds no session yet, which is the whole point
 * (`docs/API-ROUTES.md`: `POST /auth/2fa/challenge` | public). What stands in
 * for authentication is the challenge token, which step one issued only after
 * a correct password.
 */
export function useTwoFactorChallenge(): UseMutationResult<
  { user: SessionUser },
  ApiError,
  TwoFactorChallengeInput
> {
  const queryClient = useQueryClient();

  return useMutation<{ user: SessionUser }, ApiError, TwoFactorChallengeInput>({
    mutationFn: twoFactorChallenge,
    onSuccess: () => {
      // Spent: the API deleted its copy, so keeping ours only leaves a dead
      // credential in storage for the next person on this machine to find.
      forgetTwoFactorChallenge();

      // `useLogin` skips its own `clear()` on the 2FA branch — "there is no
      // new identity to reset the cache for yet — that happens after the
      // challenge succeeds". This is that moment. A shop's back-office laptop
      // is shared, and anything still cached was fetched under whoever was
      // signed in before.
      queryClient.clear();

      // The shell blocks on `GET /auth/me`, and this is the key that has to be
      // refetched for it to see the new identity. `clear()` above already
      // emptied the cache, so today this matches nothing and is here as the
      // named contract: if that discard is ever narrowed to spare some cache,
      // the session must still be invalidated. Note the call —
      // `authKeys.session` is a *function*, and passing the function itself
      // matches no query and silently invalidates nothing.
      queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}
