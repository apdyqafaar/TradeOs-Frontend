"use client";

import { CircleCheck, Link2Off, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ButtonLink } from "@/components/shared/button-link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { AuthCard } from "@/features/auth/components/auth-card";
import { useResendVerification } from "@/features/auth/hooks/use-resend-verification";
import { useSession } from "@/features/auth/hooks/use-session";
import { useVerifyEmail } from "@/features/auth/hooks/use-verify-email";
import type { ApiError } from "@/lib/api/errors";

/** How long the Resend button stays locked after a successful send. */
const COOLDOWN_SECONDS = 60;

/**
 * A terminal token failure, as opposed to a server or network one.
 *
 * `POST /auth/verify-email` collapses expired, already-spent, mistyped and
 * issued-for-a-deleted-user into one `400 BAD_REQUEST` carrying "This link is
 * invalid or has expired" (`Backend/src/services/auth.service.ts:507-520`).
 * There is no narrower code to branch on and that is deliberate — a distinct
 * "expired" would tell a caller something about a token they do not hold.
 *
 * Anything else (a 500, a 429, a dead network) is *not* an expired link, and
 * must not be dressed as one: sending someone off to request a fresh link they
 * do not need would make a transient failure permanent-looking.
 */
const isDeadToken = (error: ApiError | null): boolean => error?.status === 400;

/** The 44px tinted circle artboard `1f`'s conventions put above a panel headline. */
function PanelIcon({
  tone,
  children,
}: {
  tone: "success" | "muted";
  children: React.ReactNode;
}) {
  return (
    <span
      className={
        tone === "success"
          ? "flex size-11 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground"
          : "flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
      }
    >
      {children}
    </span>
  );
}

/**
 * The Resend action, shown only to a visitor who provably has a session.
 *
 * Split out so the countdown's `setInterval` is mounted only in the branch that
 * renders it — the signed-out branch has no timer to tear down.
 */
function ResendLink() {
  const resend = useResendVerification();
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => {
      setSecondsLeft((remaining) => Math.max(0, remaining - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const locked = secondsLeft > 0 || resend.isPending;

  return (
    <Button
      type="button"
      disabled={locked}
      onClick={() =>
        resend.mutate(undefined, {
          onSuccess: () => setSecondsLeft(COOLDOWN_SECONDS),
        })
      }
      className="h-11 w-full rounded-[10px] text-sm"
    >
      {secondsLeft > 0 ? `Resend in ${secondsLeft}s` : "Send a new link"}
    </Button>
  );
}

/**
 * The whole `/verify-email` screen: it fires the mutation, then renders the
 * outcome. Not designed — built in artboard `1f`'s conventions (Global
 * Constraints: 400px column, 36px serif headline, 44px controls, 10px radius).
 *
 * The headline changes with the state, so this component owns its `AuthCard`
 * rather than sitting inside one the page rendered. `AuthCard` has no hooks, so
 * it costs nothing to pull across the client boundary.
 */
export function VerifyEmailPanel({ token }: { token: string | null }) {
  const verify = useVerifyEmail();
  const { mutate } = verify;

  // React strict-mode invokes effects twice on mount in development. Without
  // this the token is spent by the first call and the second gets the 400 that
  // a *used* token produces — the success screen would flicker into the expired
  // one on every dev reload, for a link that was perfectly good.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || !token) return;
    fired.current = true;
    mutate({ token });
  }, [token, mutate]);

  if (verify.isSuccess) {
    return (
      <AuthCard
        headline="Your email is confirmed"
        subtitle="Everything that was waiting on it is unlocked — creating a business, inviting your staff."
      >
        <div className="flex flex-col gap-[22px]">
          <PanelIcon tone="success">
            <CircleCheck
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-5"
            />
          </PanelIcon>
          <ButtonLink
            className="h-11 w-full rounded-[10px] text-sm"
            href={ROUTES.overview}
          >
            Continue
          </ButtonLink>
        </div>
      </AuthCard>
    );
  }

  // A missing `?token=` is the same dead end as a spent one — somebody's mail
  // client truncated the link — so it lands here rather than in its own screen.
  if (!token || (verify.isError && isDeadToken(verify.error))) {
    return <DeadLinkPanel />;
  }

  if (verify.isError) {
    return (
      <AuthCard
        headline="We couldn't confirm it"
        subtitle={verify.error.message}
        footer={
          <Link
            href={ROUTES.login}
            className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Back to sign in
          </Link>
        }
      >
        <Button
          type="button"
          onClick={() => mutate({ token })}
          disabled={verify.isPending}
          className="h-11 w-full rounded-[10px] text-sm"
        >
          Try again
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      headline="Confirming your email"
      subtitle="One moment — we're checking the link you opened."
    >
      {/* `<output>` rather than `<div role="status">`: it carries that role
          implicitly and `aria-live="polite"` with it, so the state change is
          announced without a hand-written role biome would (rightly) flag. */}
      <output className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
        <LoaderCircle
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-4 animate-spin"
        />
        Verifying…
      </output>
    </AuthCard>
  );
}

/**
 * The expired / already-used / missing-token dead end.
 *
 * **This is the branch the whole task is shaped around.**
 * `POST /auth/resend-verification` is the one route in the verification flow
 * that needs a session (`docs/API-ROUTES.md`, "Three gates that bite" #1), and
 * this page is routinely opened on a *different device* from the one that
 * registered — signed up on the laptop, opened the email on the phone. There
 * the browser has no session cookie, so a Resend button would 401. Offering it
 * anyway is the bug this branch exists to prevent, so the action is chosen from
 * what `useSession()` actually answers, not from an assumption.
 *
 * While the session probe is in flight neither option is rendered: guessing and
 * then swapping would let a signed-out visitor click a Resend that vanishes.
 * The probe is cheap — `/auth/me` 401s immediately for an anonymous visitor,
 * and `/verify-email` is in the api client's `ANONYMOUS_ROUTES`, so that 401
 * does not bounce them to `/login` mid-read.
 */
function DeadLinkPanel() {
  const session = useSession();
  const signedIn = session.data !== undefined;

  return (
    <AuthCard
      headline="That link has expired"
      subtitle="Verification links last 24 hours and can only be used once. Ask for a fresh one and it will be in your inbox in a moment."
      footer={
        signedIn ? (
          <Link
            href={ROUTES.overview}
            className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Skip for now
          </Link>
        ) : null
      }
    >
      <div className="flex flex-col gap-[22px]">
        <PanelIcon tone="muted">
          <Link2Off aria-hidden="true" strokeWidth={1.75} className="size-5" />
        </PanelIcon>

        {session.isPending ? (
          // Reserves the button's height so the column does not jump when the
          // session probe answers.
          <div className="h-11" />
        ) : signedIn ? (
          <ResendLink />
        ) : (
          <div className="flex flex-col gap-[7px]">
            <ButtonLink
              className="h-11 w-full rounded-[10px] text-sm"
              href={ROUTES.login}
            >
              Sign in to send a new link
            </ButtonLink>
            <p className="text-[12px] text-muted-3">
              Sending a new link needs your account, and this device isn't
              signed in to it.
            </p>
          </div>
        )}
      </div>
    </AuthCard>
  );
}
