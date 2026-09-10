"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authKeys } from "@/features/auth/keys";
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  UpdateProfileInput,
} from "@/features/auth/schemas/auth.schema";
import {
  changePassword,
  deleteAccount,
  type SessionUser,
  updateProfile,
} from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/**
 * The three writes on the Profile tab of `/account`.
 *
 * ## `gcTime: 0` on the two that carry a password — read this before removing it
 *
 * React Query keeps a settled mutation in its cache, `variables` and all, for
 * `gcTime` (five minutes by default) so an observer that remounts can read the
 * result. For these two mutations `variables` is `{ currentPassword }` — a
 * plaintext credential — and the cache is an ordinary object in the page's
 * heap. `@tanstack/react-query-devtools` is mounted in development
 * (`app/providers.tsx:56-58`) and renders mutation variables verbatim in a
 * panel, so the default would put the user's password on screen for five
 * minutes after they typed it, and leave it in any heap snapshot or error
 * reporter that walks the cache in the meantime.
 *
 * `gcTime: 0` drops the entry the moment it has no observer, which is
 * immediately after the form unmounts or calls `reset()`. It costs nothing
 * here: neither result is read from the cache by anything.
 *
 * The same rule is why no component below holds a password in state one
 * keystroke longer than the request needs, and why **nothing in this slice
 * logs** — `console.log(variables)` in an `onError` would write the credential
 * straight to the browser console.
 */

/**
 * `PATCH /users/me` — session only. **No `requireMember`**: a user with no
 * `Member` row at all still gets a 200 (`user-profile.test.ts:181-195`), which
 * is the proof that `/account` must render without an organization.
 *
 * The response is `publicUser`, exactly five keys, so the session's `user`
 * could in principle be patched in place — but `GET /auth/me` also carries
 * `organization`, `role`, `permissions` and `twoFactorEnabled`, and writing a
 * partial object over that key would drop them. Invalidating re-reads all of
 * it, once, on an action a person takes rarely.
 *
 * Only `name` and `image` are editable. **There is no email change anywhere in
 * this API** — deliberately absent from `updateProfileSchema` upstream because
 * it needs a verification round trip that does not exist yet
 * (`user.validation.ts:16-22`), so the email is rendered read-only with a note
 * rather than as a field that cannot be saved.
 */
export function useUpdateProfile(): UseMutationResult<
  SessionUser,
  ApiError,
  UpdateProfileInput
> {
  const queryClient = useQueryClient();

  return useMutation<SessionUser, ApiError, UpdateProfileInput>({
    mutationFn: updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}

/**
 * `POST /auth/change-password` — 10 attempts / 15 min per IP.
 *
 * **The caller stays signed in.** The handler deliberately leaves this
 * session's cookie alive (`auth.controller.ts:188-189`) and revokes every
 * *other* one; `revokedSessions` is that count. So this must not redirect to
 * `/login` on success — the screen reports the number instead.
 *
 * The device list is invalidated because those other sessions are now gone and
 * the Sessions tab would otherwise keep listing them.
 *
 * Failures worth branching on: **401** for a wrong current password (byte
 * identical to what `login` answers — `account.test.ts:258-288` — so the
 * message cannot tell the flows apart), **400 `BAD_REQUEST`** when the new
 * password equals the old one, **422** when it is shorter than 8.
 */
export function useChangePassword(): UseMutationResult<
  { revokedSessions: number },
  ApiError,
  ChangePasswordInput
> {
  const queryClient = useQueryClient();

  return useMutation<
    { revokedSessions: number },
    ApiError,
    ChangePasswordInput
  >({
    mutationFn: changePassword,
    gcTime: 0,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.sessions() });
    },
  });
}

/**
 * `DELETE /auth/account` — **with a JSON body**, `{ currentPassword }`. A
 * bodyless DELETE is a 422, not a 401 (`account.test.ts:486-497`);
 * `apiDelete` passes `{ data }` through to axios, which sends it.
 *
 * **An organization owner can never succeed here.** `countOrganizationsOwnedBy
 * > 0` is a 409 `OWNS_ORGANIZATION` checked twice — once before the
 * transaction and once inside it — and there is no ownership-transfer endpoint
 * anywhere in the API to clear it with. The UI says so where the button would
 * be rather than offering an action that always refuses; see
 * `components/delete-account-panel.tsx`.
 *
 * On success the API clears the cookie server-side and the user row is **hard
 * deleted** — no soft-delete, no retention window, and the email is
 * immediately re-registerable (`account.test.ts:446-467`). So the copy must not
 * promise "your data is kept for 30 days", because it is not.
 *
 * `queryClient.clear()` on settled, for the reason `useLogout` gives: whatever
 * is cached belongs to a session that no longer exists.
 */
export function useDeleteAccount(): UseMutationResult<
  void,
  ApiError,
  DeleteAccountInput
> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, DeleteAccountInput>({
    mutationFn: deleteAccount,
    gcTime: 0,
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
