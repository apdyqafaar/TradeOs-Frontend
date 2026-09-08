"use client";

import { cn } from "cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { AuthErrorBanner } from "@/features/auth/components/auth-error-banner";
import { CodeInput } from "@/features/auth/components/code-input";
import type { PendingTwoFactorChallenge } from "@/features/auth/hooks/use-two-factor-challenge";
import {
  forgetTwoFactorChallenge,
  readTwoFactorChallenge,
  useTwoFactorChallenge,
} from "@/features/auth/hooks/use-two-factor-challenge";
import type { ApiError } from "@/lib/api/errors";
import { API_ERROR_CODE, fieldErrorsFor } from "@/lib/api/errors";

/** Artboard `1f` draws six boxes; the API's TOTP is six digits. */
const CODE_LENGTH = 6;

/**
 * What the banner says for a failure the boxes cannot explain themselves.
 *
 * `UNAUTHORIZED` covers two different situations that the API deliberately
 * does not separate — a wrong code, and a challenge that is unknown, expired
 * or already spent — because telling them apart would tell an attacker which
 * half of the guess was right (`Backend/src/services/two-factor.service.ts`,
 * `INVALID_CODE` / `INVALID_CHALLENGE`, both 401 `UNAUTHORIZED`). So one
 * message has to serve both, and it has to point at the way out of each.
 */
function bannerMessage(error: ApiError | null): string | null {
  if (!error) return null;

  switch (error.code) {
    case API_ERROR_CODE.UNAUTHORIZED:
      return "That code isn't right. If it keeps failing, sign in again for a new one.";
    case API_ERROR_CODE.TOO_MANY_REQUESTS:
      return "Too many attempts — try again in a few minutes.";
    default:
      return error.message;
  }
}

/** The dead end: no challenge in this tab, or one the API will no longer take. */
function ChallengeExpired() {
  return (
    <div className="flex flex-col gap-[22px]">
      <AuthErrorBanner message="This sign-in request has expired. Sign in again to get a new code." />
      <Link
        href={ROUTES.login}
        className={cn(buttonVariants(), "h-11 w-full rounded-[10px] text-sm")}
      >
        Sign in again
      </Link>
    </div>
  );
}

/**
 * Step two of signing in (artboard `1f`, `docs/design/TradeOs-UI.dc.html:2740`).
 *
 * The challenge token is not in the URL and not in a cookie — see
 * `use-two-factor-challenge.ts` for why — so the first thing this does is look
 * for the one the login form parked in `sessionStorage`. Reading it in an
 * effect rather than in a lazy initialiser is deliberate: `sessionStorage` does
 * not exist while Next prerenders this page, and a component that renders one
 * tree on the server and another on the client is a hydration error.
 */
export function TwoFactorForm() {
  const router = useRouter();
  const challenge = useTwoFactorChallenge();

  const [code, setCode] = useState("");
  // `undefined` is "not looked yet" — the server render and the first client
  // render, which must agree. `null` is "looked, found nothing".
  const [pending, setPending] = useState<
    PendingTwoFactorChallenge | null | undefined
  >(undefined);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setPending(readTwoFactorChallenge());
  }, []);

  useEffect(() => {
    if (!pending) return;

    const remaining = new Date(pending.expiresAt).getTime() - Date.now();
    // An unparseable date gives NaN. Treat that as "no client-side deadline"
    // and let the API be the judge, rather than locking the user out on a
    // field this screen only uses as a courtesy.
    if (Number.isNaN(remaining)) return;
    if (remaining <= 0) {
      setExpired(true);
      forgetTwoFactorChallenge();
      return;
    }

    // The API will refuse the token the moment it lapses, so say so before the
    // user finishes typing into a box that can no longer work.
    const timer = setTimeout(() => {
      setExpired(true);
      forgetTwoFactorChallenge();
    }, remaining);
    return () => clearTimeout(timer);
  }, [pending]);

  /**
   * Set the instant a request leaves, cleared when it settles.
   *
   * `challenge.isPending` is React state and only becomes true on the next
   * render, so it cannot stop a second call raised in the same tick — an
   * authenticator autofill that fires `change` twice, or a click landing on
   * the same keystroke that completed the code. This ref can.
   */
  const inFlight = useRef(false);

  const submit = (value: string) => {
    if (inFlight.current || challenge.isPending) return;
    if (!pending || expired) return;
    if (value.length !== CODE_LENGTH) return;

    inFlight.current = true;
    challenge.mutate(
      { challengeToken: pending.challengeToken, code: value },
      {
        onSuccess: () => {
          // `replace`, not `push`: the challenge is spent, so leaving this
          // screen in the history would give Back a page that can only fail.
          router.replace(ROUTES.overview);
        },
        onError: (error) => {
          // A 422 on `challengeToken` means the parked value is not something
          // the API will even look at. Nothing the user can type fixes that.
          if (fieldErrorsFor(error).challengeToken) {
            setExpired(true);
            forgetTwoFactorChallenge();
          }
          // Clear the boxes so the retry starts from an empty row rather than
          // making the user delete six digits first.
          setCode("");
        },
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  const handleChange = (value: string) => {
    setCode(value);
    // The whole point of six boxes: the last digit is the submit gesture.
    if (value.length === CODE_LENGTH) submit(value);
  };

  if (pending === null || expired) return <ChallengeExpired />;

  const banner = bannerMessage(challenge.error);
  const codeError = fieldErrorsFor(challenge.error).code;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit(code);
      }}
      className="flex flex-col gap-[22px]"
    >
      {banner ? <AuthErrorBanner message={banner} /> : null}

      <div className="flex flex-col gap-[7px]">
        <CodeInput
          length={CODE_LENGTH}
          value={code}
          onChange={handleChange}
          label="Verification code"
          // `undefined` is the render before the effect has looked in storage.
          // Disabled rather than absent, so the column does not resize under
          // the user in the overwhelmingly common case that a challenge is
          // there.
          disabled={pending === undefined || challenge.isPending}
          invalid={Boolean(challenge.error)}
          describedBy={codeError ? "two-factor-code-error" : undefined}
        />
        {codeError ? (
          <p id="two-factor-code-error" className="text-destructive text-xs">
            {codeError}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        disabled={
          pending === undefined ||
          challenge.isPending ||
          code.length !== CODE_LENGTH
        }
        className="h-11 w-full rounded-[10px] text-sm"
      >
        {challenge.isPending ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}
