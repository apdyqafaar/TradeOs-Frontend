"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authKeys } from "@/features/auth/keys";
import type {
  TwoFactorDisableInput,
  TwoFactorVerifyInput,
} from "@/features/auth/schemas/auth.schema";
import {
  disableTwoFactor,
  setupTwoFactor,
  verifyTwoFactor,
} from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/**
 * The three signed-in two-factor calls. (The fourth, `/2fa/challenge`, is
 * public and belongs to the login screen — `features/auth` already owns it.)
 *
 * ## `gcTime: 0` on all three, and it is not optional here
 *
 * `setup` **returns the TOTP secret**, `verify` **returns the ten recovery
 * codes**, and `disable` **takes a password and a code**. React Query keeps a
 * settled mutation's `data` and `variables` in its cache for five minutes by
 * default, and `@tanstack/react-query-devtools` renders both verbatim in
 * development (`app/providers.tsx:56-58`). Every one of those three payloads is
 * a credential. `gcTime: 0` drops the entry as soon as it has no observer.
 *
 * Nothing in this slice logs, for the same reason: a `console.log(data)` in an
 * `onSuccess` here would write ten recovery codes into the browser console,
 * where they outlive the tab.
 *
 * ## The state machine, which is not obvious from the endpoints
 *
 * `setup` does **not** turn 2FA on. It mints a fresh secret and stores it with
 * `enabled: false` (`two-factor.actions.ts:34-39`); only a correct TOTP at
 * `verify` flips the flag. Calling `setup` twice replaces the pending secret
 * and the first one stops working (`two-factor-setup.test.ts:110-131`), so a UI
 * that re-requests options behind the user's back invalidates the QR they are
 * looking at.
 *
 * There is **no `GET /auth/2fa/status`**. `twoFactorEnabled` on `GET /auth/me`
 * is the only source of truth, which is why every mutation here invalidates the
 * session.
 */

/**
 * `POST /auth/2fa/setup` — **no body**. The route's `noBodySchema` makes
 * `{ anything: 1 }` a 422 rather than a no-op
 * (`two-factor-setup.test.ts:146-160`), so the service sends nothing at all.
 *
 * Answers `{ otpauthUri, secret }` and **no QR image** — deliberately, so the
 * client renders it (`Backend/src/lib/totp.ts:34-45`). `secret` is the
 * manual-entry fallback for an authenticator that cannot scan.
 *
 * **409 `ALREADY_ENABLED`** if 2FA is already on.
 */
export function useSetupTwoFactor(): UseMutationResult<
  { otpauthUri: string; secret: string },
  ApiError,
  void
> {
  return useMutation<{ otpauthUri: string; secret: string }, ApiError, void>({
    mutationFn: setupTwoFactor,
    gcTime: 0,
  });
}

/**
 * `POST /auth/2fa/verify` `{ code }` — **six digits, and only six digits**.
 * The schema is `/^\d{6}$/`, so a recovery code here is a **422**, not a 401
 * (contract §3). The loose 1..64 rule applies only to `/2fa/challenge` and
 * `/2fa/disable`, which is why this slice does not share one code component
 * with one validation rule across all three screens.
 *
 * Answers **ten recovery codes, exactly once**. They are stored as argon2id
 * hashes (`two-factor.service.ts:127-132`); there is no endpoint to view them
 * again, no regeneration, and no "how many are left" — `usedAt` exists in the
 * database and is never serialised. The dialog that calls this must force an
 * explicit "I have saved these" before it closes, because closing it is the
 * moment they are gone.
 */
export function useVerifyTwoFactor(): UseMutationResult<
  { recoveryCodes: string[] },
  ApiError,
  TwoFactorVerifyInput
> {
  const queryClient = useQueryClient();

  return useMutation<
    { recoveryCodes: string[] },
    ApiError,
    TwoFactorVerifyInput
  >({
    mutationFn: verifyTwoFactor,
    gcTime: 0,
    onSuccess: () => {
      // `twoFactorEnabled` on `GET /auth/me` is the only place the new state
      // is readable.
      queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}

/**
 * `POST /auth/2fa/disable` `{ currentPassword, code }` — **both**, and a
 * session cookie alone is deliberately not enough
 * (`two-factor.service.ts:188-213`, with a break-test at
 * `two-factor-setup.test.ts:249-278`). The `code` may be a TOTP **or** a
 * recovery code here, unlike `verify`.
 *
 * Returns `{ success, message }` with **no `data` key at all**
 * (`two-factor.controller.ts:75`), hence `void`.
 *
 * Wrong password → 401 "Email or password is incorrect"; wrong code → 401
 * "That verification code is not valid"; 2FA already off → 400. The first two
 * are indistinguishable by status, so the panel puts a 401 on both fields
 * rather than guessing which one was wrong.
 */
export function useDisableTwoFactor(): UseMutationResult<
  void,
  ApiError,
  TwoFactorDisableInput
> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, TwoFactorDisableInput>({
    mutationFn: disableTwoFactor,
    gcTime: 0,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}
