"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useResendVerification } from "@/features/auth/hooks/use-resend-verification";

/**
 * How long Resend stays disabled after a link goes out.
 *
 * A courtesy, not a control: the real limit is the API's, five per hour per IP
 * on the `resend-verification` bucket. This only stops the double-click that
 * spends two of those five. `check-email-panel.tsx` keeps its own copy on
 * purpose — the two surfaces have separate lifetimes, which is why
 * `useResendVerification` does not own the countdown.
 */
const COOLDOWN_SECONDS = 60;

/**
 * The amber strip under the topbar when `session.user.emailVerified === false`
 * (artboard `1c`, `docs/design/TradeOs-UI.dc.html:2110`).
 *
 * It lives in `features/auth` rather than `components/layout` because it is
 * auth's fact and auth's endpoint; the shell only decides where it hangs.
 *
 * Resend can be offered here because `POST /auth/resend-verification` needs a
 * session and this strip only ever renders inside the shell, which has one.
 * The success toast belongs to `useResendVerification`; a failure is already
 * surfaced by the client's interceptor (it toasts a 429, and redirects a lost
 * session), so the strip stays one line tall in every state.
 */
export function UnverifiedEmailStrip() {
  const resend = useResendVerification();
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1_000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const cooling = secondsLeft > 0;

  const onResend = () => {
    // No argument: the endpoint's validator is a strict empty body, so
    // `mutate({})` would be a 422. The countdown starts on success, not on
    // click — a link that failed to send should not lock the button for a
    // minute as if it had.
    resend.mutate(undefined, {
      onSuccess: () => setSecondsLeft(COOLDOWN_SECONDS),
    });
  };

  return (
    <div
      // `#E8DCBC` has no token of its own; the warning hue at 20% over the soft
      // tint lands within a few units of it and survives the dark theme, which
      // a literal hex would not.
      className="flex items-center gap-2 border-warning/20 border-b bg-warning-soft px-4 py-2 lg:px-6"
    >
      <TriangleAlert
        aria-hidden="true"
        className="size-[15px] shrink-0 text-warning"
        strokeWidth={1.75}
      />
      <p className="min-w-0 text-[13px] text-warning-strong">
        Your email isn't verified yet. Some actions are limited.
      </p>
      <button
        type="button"
        onClick={onResend}
        disabled={cooling || resend.isPending}
        className="shrink-0 rounded-sm font-medium text-[13px] text-warning underline underline-offset-2 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:text-warning-strong/70 disabled:no-underline"
      >
        {cooling ? `Resend in ${secondsLeft}s` : "Resend verification"}
      </button>
    </div>
  );
}
