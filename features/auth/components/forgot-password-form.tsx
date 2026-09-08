"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/config/routes";
import { AuthCard } from "@/features/auth/components/auth-card";
import { AuthErrorBanner } from "@/features/auth/components/auth-error-banner";
import { useForgotPassword } from "@/features/auth/hooks/use-forgot-password";
import {
  type ForgotPasswordInput,
  forgotPasswordSchema,
} from "@/features/auth/schemas/auth.schema";
import type { ApiError } from "@/lib/api/errors";
import { API_ERROR_CODE, fieldErrorsFor } from "@/lib/api/errors";

/** The centred "Back to sign in" line under both states. */
const backToSignIn = (
  <Link
    href={ROUTES.login}
    className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
  >
    Back to sign in
  </Link>
);

/** Everything except the 429 and a 422 the field itself can show. */
function bannerMessage(error: ApiError | null): string | null {
  if (!error) return null;
  if (Object.keys(error.fieldErrors ?? {}).length > 0) return null;
  // The api client already toasts a 429 with the limiter's own sentence; a
  // banner repeating it is noise.
  if (error.code === API_ERROR_CODE.TOO_MANY_REQUESTS) return null;
  return error.message;
}

/**
 * Step one of a password reset. Not designed — built in artboard `1f`'s
 * conventions (Global Constraints: 400px column, 36px serif headline, 44px
 * field, 10px radius, 7px label gap).
 *
 * The point of the screen is the sentence it shows afterwards.
 * `POST /auth/forgot-password` answers 200 for an address with no account
 * exactly as it does for one with an account, deliberately, so that this page
 * cannot be used to find out who banks with which shop
 * (`Backend/src/services/auth.service.ts:459`). A confirmation reading "we've
 * emailed you" would hand that back — the absence of an error would become the
 * answer. So the panel says "if that address exists": true in both cases,
 * informative in neither.
 *
 * It owns its own `AuthCard` because the headline is part of the state. A card
 * supplied by the page would still say "Forgot your password?" over the
 * confirmation. `AuthCard` holds no hooks, so pulling it across the client
 * boundary costs nothing.
 */
export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const forgot = useForgotPassword();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit((values) => {
    forgot.mutate(values, {
      onSuccess: () => setSentTo(values.email),
      onError: (error: ApiError) => {
        const message = fieldErrorsFor(error).email;
        if (message) setError("email", { type: "server", message });
      },
    });
  });

  if (sentTo !== null) {
    return (
      <AuthCard headline="Check your email" footer={backToSignIn}>
        <div className="flex flex-col gap-[18px]">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft">
            <MailCheck
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-5 text-primary"
            />
          </span>
          {/* One text node, not a sentence wrapped around a <strong>: the
              address goes on its own line so the neutral clause reads whole,
              to a screen reader as much as to a test. */}
          <p className="text-[14px] leading-[1.55]">
            If that address exists, a link to choose a new password is on its
            way. It expires in an hour.
          </p>
          <p className="font-mono text-[13px] text-muted-foreground">
            {sentTo}
          </p>
        </div>
      </AuthCard>
    );
  }

  const banner = bannerMessage(forgot.error);

  return (
    <AuthCard
      headline="Forgot your password?"
      subtitle="Type the address you sign in with and we'll email you a link to set a new one."
      footer={backToSignIn}
    >
      {/* `noValidate`: the browser's bubble on `type="email"` would preempt the
          resolver and the user would never see the form's own message. */}
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-[22px]">
        {banner ? <AuthErrorBanner message={banner} /> : null}

        <div className="flex flex-col gap-[7px]">
          <Label htmlFor="forgot-email" className="text-[13px]">
            Email
          </Label>
          <Input
            {...register("email")}
            id="forgot-email"
            type="email"
            autoComplete="email"
            autoFocus
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "forgot-email-error" : undefined}
            className="h-11 rounded-[10px] bg-card dark:bg-card"
          />
          {errors.email ? (
            <p id="forgot-email-error" className="text-destructive text-xs">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          disabled={forgot.isPending}
          className="h-11 w-full rounded-[10px] text-sm"
        >
          {forgot.isPending ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  );
}
