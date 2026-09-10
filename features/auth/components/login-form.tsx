"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/config/routes";
import { AuthErrorBanner } from "@/features/auth/components/auth-error-banner";
import type { LoginResult } from "@/features/auth/hooks/use-login";
import { useLogin } from "@/features/auth/hooks/use-login";
import { rememberTwoFactorChallenge } from "@/features/auth/hooks/use-two-factor-challenge";
import {
  type LoginInput,
  loginSchema,
} from "@/features/auth/schemas/auth.schema";
import type { ApiError } from "@/lib/api/errors";
import { API_ERROR_CODE, fieldErrorsFor } from "@/lib/api/errors";
import { isSafeInternalPath } from "@/lib/auth/safe-path";

/** The two fields the form owns; anything else in a 422 goes to the banner. */
const FIELDS = ["email", "password"] as const;

/**
 * What the banner says for a failure that is not a per-field one.
 *
 * Branches on `code`, never on `message` — the API's prose changes freely and
 * "Wrong email or password." is deliberately vaguer than whatever it sends, so
 * the page cannot be used to find out which half was right.
 */
function bannerMessage(error: ApiError | null): string | null {
  if (!error) return null;
  // A 422 was already written onto the inputs by `onError` below.
  if (Object.keys(error.fieldErrors ?? {}).length > 0) return null;

  switch (error.code) {
    case API_ERROR_CODE.UNAUTHORIZED:
      return "Wrong email or password.";
    case API_ERROR_CODE.TOO_MANY_REQUESTS:
      return "Too many attempts — try again in a few minutes.";
    default:
      return error.message;
  }
}

/**
 * Step one of signing in (artboard `1f`).
 *
 * The success branch is the whole point: `POST /auth/login` answers with a
 * discriminated union and only `twoFactorRequired: false` carries a session
 * cookie. Pushing to the overview on the `true` branch would land on a page
 * that immediately 401s, so the challenge token goes to `/login/2fa` instead.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useLogin();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSuccess = (result: LoginResult) => {
    if (result.twoFactorRequired) {
      // The challenge token lives ONLY in this response body — the 2FA branch
      // sets no cookie — so if it is not parked here it is gone, and the next
      // screen has nothing to send. Park it before navigating.
      rememberTwoFactorChallenge(result);
      router.push(ROUTES.twoFactor);
      return;
    }
    // `next` is where the proxy sent them from; the overview is the default.
    //
    // Validated, not trusted. The honest value is minted by `proxy.ts` or by
    // the app layout, but the parameter sits in a URL anyone can compose and
    // send: `/login?next=//evil.example` is protocol-relative, so pushing it
    // unchecked walks the user off this origin immediately after they typed
    // their password on a page they reached from this product's own domain.
    // `isSafeInternalPath` is the same predicate the server-side gate applies
    // to the header it reads, so both ends agree on what "internal" means.
    const next = searchParams.get("next");
    router.push(next && isSafeInternalPath(next) ? next : ROUTES.overview);
  };

  const onError = (error: ApiError) => {
    const fields = fieldErrorsFor(error);
    for (const field of FIELDS) {
      const message = fields[field];
      if (message) setError(field, { type: "server", message });
    }
  };

  const onSubmit = handleSubmit((values) => {
    login.mutate(values, { onSuccess, onError });
  });

  const banner = bannerMessage(login.error);

  return (
    // `noValidate`: the browser's own bubble on `type="email"` would preempt
    // the resolver and the user would never see the form's message.
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-[22px]">
      {banner ? <AuthErrorBanner message={banner} /> : null}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-[7px]">
          <Label htmlFor="login-email" className="text-[13px]">
            Email
          </Label>
          <Input
            {...register("email")}
            id="login-email"
            type="email"
            autoComplete="email"
            autoFocus
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "login-email-error" : undefined}
            className="h-11 rounded-[10px] bg-card dark:bg-card"
          />
          {errors.email ? (
            <p id="login-email-error" className="text-destructive text-xs">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-[7px]">
          <Label htmlFor="login-password" className="text-[13px]">
            Password
          </Label>
          <Input
            {...register("password")}
            id="login-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={
              errors.password ? "login-password-error" : undefined
            }
            className="h-11 rounded-[10px] bg-card dark:bg-card"
          />
          {errors.password ? (
            <p id="login-password-error" className="text-destructive text-xs">
              {errors.password.message}
            </p>
          ) : null}
          <Link
            href={ROUTES.forgotPassword}
            className="self-end rounded-sm text-primary text-xs outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Forgot password?
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3.5">
        <Button
          type="submit"
          disabled={login.isPending}
          className="h-11 w-full rounded-[10px] text-sm"
        >
          {login.isPending ? "Signing in…" : "Continue"}
        </Button>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-muted-2 text-xs">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* Out of scope for this slice: no WebAuthn ceremony is wired yet, so
            the button is rendered and disabled rather than hidden — artboard
            `1f` draws it, and hiding it would make the column shorter than the
            design. */}
        <Button
          type="button"
          variant="outline"
          disabled
          title="Coming soon"
          className="h-11 w-full gap-[9px] rounded-[10px] bg-card text-sm dark:bg-card"
        >
          <KeyRound strokeWidth={1.75} className="text-muted-foreground" />
          Sign in with a passkey
        </Button>
      </div>
    </form>
  );
}
