"use client";

import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthErrorBanner } from "@/features/auth/components/auth-error-banner";
import { useResendVerification } from "@/features/auth/hooks/use-resend-verification";
import type { ApiError } from "@/lib/api/errors";
import { API_ERROR_CODE } from "@/lib/api/errors";

/**
 * How long Resend stays disabled after a link goes out.
 *
 * A courtesy, not a control: the real limit is the API's, five per hour per IP
 * on the `resend-verification` bucket (`Backend/src/routes/v1/auth.route.ts:65`).
 * This only stops the double-click that spends two of those five.
 */
const COOLDOWN_SECONDS = 60;

function resendError(error: ApiError | null): string | null {
  if (!error) return null;
  if (error.code === API_ERROR_CODE.TOO_MANY_REQUESTS) {
    return "That is as many links as we can send for now — try again in an hour.";
  }
  // A 401 never reaches here: `/auth/resend-verification` is not one of the
  // client's `AUTH_ENTRY_PATHS`, so the interceptor treats a lost session as
  // the app's problem and redirects to /login before this renders.
  return error.message;
}

/**
 * What `/register` shows once the account exists (undesigned; artboard `1f`'s
 * conventions plus the icon-in-a-circle the verify-email screen also uses).
 *
 * Resend can be offered here — and only here and in the shell — because
 * `POST /auth/resend-verification` needs a session and registration sets the
 * cookie before it answers. On the *expired-link* page, which is routinely
 * opened on a second device, it cannot.
 *
 * The 60-second cooldown lives in this component rather than in
 * `useResendVerification` so the shell's unverified-email strip can set its
 * own. It is per-mount state and does not survive a reload — the API's hourly
 * cap is the limit that actually holds.
 */
export function CheckEmailPanel({ email }: { email: string }) {
  const resend = useResendVerification();
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1_000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const onResend = () => {
    // The countdown starts on success, not on click: a link that failed to
    // send should not lock the button for a minute as if it had.
    resend.mutate(undefined, {
      onSuccess: () => setSecondsLeft(COOLDOWN_SECONDS),
    });
  };

  const cooling = secondsLeft > 0;
  const error = resendError(resend.error);

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-[22px]">
      <div className="flex flex-col gap-2">
        <span
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground"
        >
          <Mail strokeWidth={1.75} className="size-5" />
        </span>
        <h1 className="mt-2 font-serif text-[36px] leading-[1.08]">
          Check your email
        </h1>
        <p className="text-muted-foreground text-sm">
          We sent a verification link to{" "}
          <span className="font-medium text-foreground">{email}</span>. Open it
          to confirm the address — you will need to before you can create your
          business.
        </p>
      </div>

      {error ? <AuthErrorBanner message={error} /> : null}

      <div className="flex flex-col gap-3.5">
        <Button
          type="button"
          variant="outline"
          onClick={onResend}
          disabled={cooling || resend.isPending}
          className="h-11 w-full rounded-[10px] bg-card text-sm dark:bg-card"
        >
          {cooling ? `Resend in ${secondsLeft}s` : "Resend"}
        </Button>

        {/* The link is public (`POST /auth/verify-email` takes no session), so
            reading the mail on a phone works. Asking for a *new* one does not
            — that route needs the session this browser is holding. */}
        <p className="text-center text-[13px] text-muted-foreground">
          No email after a minute? Check your spam folder. The link opens on any
          device.
        </p>
      </div>
    </div>
  );
}
