"use client";

import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { resendVerification } from "@/features/auth/services/auth.service";
import type { ApiError } from "@/lib/api/errors";

/**
 * Mails a fresh email-verification link to the signed-in user.
 *
 * `POST /auth/resend-verification` needs a **session** (`docs/API-ROUTES.md`,
 * "Three gates that bite" #1) — it is the one route in the verification flow
 * that is not public. That is exactly why the check-your-email panel may offer
 * it: registration sets the session cookie before it answers
 * (`Backend/src/controller/auth.controller.ts:31`), so the button works on the
 * device that just registered. A page that cannot promise a session — the
 * expired-link screen, opened on a phone — must send the user to sign in
 * instead of rendering a Resend that 401s.
 *
 * **Takes and returns nothing.** The endpoint has no body at all (its
 * validator is `noBodySchema`, a strict empty object), and the response is a
 * bare success envelope, so the mutation variable is `void`: call it as
 * `resend.mutate()`.
 *
 * **No cache invalidation.** Sending a link does not verify anything —
 * `session.user.emailVerified` only flips on `POST /auth/verify-email` — so
 * invalidating `authKeys.session()` here would refetch and get the same
 * `false` back.
 *
 * **The toast lives here; the cooldown does not.** Every caller wants the same
 * confirmation, so it is centralised. The 60-second lockout is deliberately
 * left to the caller: the check-your-email panel and the shell's
 * unverified-email strip are separate surfaces with separate lifetimes, and a
 * shared cooldown in this hook would be per-hook-instance anyway — two mounted
 * copies would each keep their own, which is the confusing half of both worlds.
 * See `check-email-panel.tsx` for the component-side implementation.
 */
export function useResendVerification(): UseMutationResult<
  void,
  ApiError,
  void
> {
  return useMutation<void, ApiError, void>({
    mutationFn: resendVerification,
    onSuccess: () => {
      toast.success("Verification email sent", {
        description: "Check your inbox — the link is good for one use.",
      });
    },
  });
}
