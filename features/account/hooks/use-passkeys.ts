"use client";

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createPasskeyCredential } from "@/features/account/lib/webauthn";
import { authKeys } from "@/features/auth/keys";
import {
  deletePasskey,
  listPasskeys,
  type Passkey,
  passkeyRegisterOptions,
  passkeyRegisterVerify,
} from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/** Upstream cap, and the 409 that enforces it (`passkey.service.ts:176-180`). */
export const MAX_PASSKEYS = 20;

/**
 * `GET /auth/passkeys` — newest first, four fields per row:
 * `{ id, label, createdAt, lastUsedAt }`.
 *
 * **No `transports`, no device type, no `publicKey`, no `credentialId`** — the
 * API's own test scans the serialized body to prove it (`passkeys.test.ts:594-621`).
 * So the list cannot show a "security key" versus "this device" icon, and the
 * label the person typed at registration is the only thing distinguishing one
 * row from another. That is why the label field is not optional in the UI even
 * though it would be easier to auto-generate one.
 */
export function usePasskeys(): UseQueryResult<Passkey[], ApiError> {
  return useQuery<Passkey[], ApiError>({
    queryKey: authKeys.passkeys(),
    queryFn: async () => (await listPasskeys()).passkeys,
    staleTime: 60_000,
  });
}

/**
 * The whole registration ceremony as one mutation: options, the browser
 * prompt, then verify.
 *
 * ## Why the three steps are one mutation and not three
 *
 * **A failed verify burns the challenge** (`passkey.service.ts:216-227`) —
 * the exact opposite of the 2FA challenge token, where a wrong code leaves the
 * token usable. Any retry has to start from a fresh `/options` call. Splitting
 * this into separate hooks invites a component to re-submit the same credential
 * against a spent challenge, which answers 401 "This passkey request is invalid
 * or has expired" and reads like a broken device rather than a spent nonce.
 *
 * Registration challenges also expire after five minutes and are single-use,
 * and both `/passkeys/register/*` routes **share one rate-limit bucket** of 20
 * per 15 minutes — so somebody fumbling the OS prompt a few times can reach a
 * 429 on a settings page. Keeping the pair together is what makes "press the
 * button again" cost exactly two requests rather than an accumulating tail.
 *
 * ## `label` is required and the server never invents one
 *
 * `passkeyRegisterVerifySchema` has `label: string` at 1..100
 * (`passkey.validation.ts:66-69`) and **there is no rename route** — the label
 * is permanent (`passkeyRenameSchema` exists upstream and is imported by
 * nothing). So it is collected before the ceremony, while the person still has
 * a reason to think about which device this is.
 */
export interface RegisterPasskeyVariables {
  label: string;
}

export function useRegisterPasskey(): UseMutationResult<
  Passkey,
  Error,
  RegisterPasskeyVariables
> {
  const queryClient = useQueryClient();

  return useMutation<Passkey, Error, RegisterPasskeyVariables>({
    mutationFn: async ({ label }) => {
      // Always fresh: the previous attempt's challenge is spent whether it
      // succeeded or failed.
      const { options } = await passkeyRegisterOptions();
      // Straight into the browser API, untouched — the JSON the server sends is
      // exactly what WebAuthn's own parser consumes.
      const response = await createPasskeyCredential(options);
      const { passkey } = await passkeyRegisterVerify({ label, response });
      return passkey;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.passkeys() });
    },
  });
}

/**
 * `DELETE /auth/passkeys/:id` — 200 with **no `data`**, hence `void`.
 *
 * Another user's passkey, or an unknown id, is a **404 and never a 403**
 * (`passkey.service.ts:443-445`), which is deliberate: a 403 would confirm the
 * id belongs to somebody. A malformed id is a 422 before any query runs.
 */
export function useDeletePasskey(): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, string>({
    mutationFn: deletePasskey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.passkeys() });
    },
  });
}
