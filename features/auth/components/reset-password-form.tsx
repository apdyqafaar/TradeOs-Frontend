"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Link2Off } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/config/routes";
import { AuthCard } from "@/features/auth/components/auth-card";
import { AuthErrorBanner } from "@/features/auth/components/auth-error-banner";
import { useResetPassword } from "@/features/auth/hooks/use-reset-password";
import type { ApiError } from "@/lib/api/errors";
import { API_ERROR_CODE, fieldErrorsFor } from "@/lib/api/errors";

/**
 * The form's shape, which is not the wire's.
 *
 * `resetPasswordSchema` in `features/auth/schemas/auth.schema.ts` mirrors the
 * API body — `{ token, password }` — and the API has no opinion about a second
 * box, because a mistyped new password is purely a client-side problem: there
 * is nobody to ask afterwards and the account stays locked out until another
 * link is mailed. So the confirmation field lives here. The `password` rule is
 * copied from the shared one (8–128, same messages) rather than imported,
 * because `.refine` has to sit on the object that holds both fields; if the
 * backend's bound ever moves, both copies move together.
 */
const resetPasswordFormSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password must be at most 128 characters"),
    confirmPassword: z.string().min(1, "Type the password again to confirm"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Those two passwords do not match",
    path: ["confirmPassword"],
  });

type ResetPasswordFormInput = z.infer<typeof resetPasswordFormSchema>;

/**
 * A spent, expired or mistyped token. One 400 `BAD_REQUEST` covers all of them
 * — see `use-verify-email.ts` for why the API refuses to tell them apart.
 */
const isDeadToken = (error: ApiError | null): boolean => error?.status === 400;

function bannerMessage(error: ApiError | null): string | null {
  if (!error) return null;
  if (Object.keys(error.fieldErrors ?? {}).length > 0) return null;
  // The api client already toasts the limiter's own sentence.
  if (error.code === API_ERROR_CODE.TOO_MANY_REQUESTS) return null;
  return error.message;
}

/**
 * The dead end for a link that cannot be spent.
 *
 * Unlike the verification flow, this one needs no session branch: a new reset
 * link is `POST /auth/forgot-password`, which is public, so the same offer
 * works on any device. That asymmetry is exactly why `verify-email-panel.tsx`
 * has to check `useSession()` and this file does not.
 */
function DeadLinkPanel() {
  return (
    <AuthCard
      headline="That link has expired"
      subtitle="Reset links last an hour and can only be used once. Ask for another and you can set your password from the new one."
      footer={
        <Link
          href={ROUTES.login}
          className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Back to sign in
        </Link>
      }
    >
      <div className="flex flex-col gap-[22px]">
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Link2Off aria-hidden="true" strokeWidth={1.75} className="size-5" />
        </span>
        <Button
          render={<Link href={ROUTES.forgotPassword} />}
          className="h-11 w-full rounded-[10px] text-sm"
        >
          Send a new link
        </Button>
      </div>
    </AuthCard>
  );
}

/**
 * Sets a new password from an emailed token. Not designed — built in artboard
 * `1f`'s conventions (Global Constraints).
 *
 * On success the API revokes **every** session on the account, this browser's
 * included (`Backend/src/services/auth.service.ts:533` — the revocation "is the
 * point of the endpoint, not a courtesy"), so `/login` is the only place left
 * to go. Staying put would render a signed-in-looking screen backed by a cookie
 * the server has already thrown away.
 */
export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const reset = useResetPassword();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ResetPasswordFormInput>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  // A missing `?token=` is the same dead end as a spent one — a mail client
  // wrapped the link and dropped the query — so it lands on the same panel.
  if (!token || isDeadToken(reset.error)) return <DeadLinkPanel />;

  const onSubmit = handleSubmit((values) => {
    reset.mutate(
      { token, password: values.password },
      {
        onSuccess: () => {
          toast.success("Password changed", {
            description: "Sign in with your new password.",
          });
          router.push(ROUTES.login);
        },
        onError: (error: ApiError) => {
          const message = fieldErrorsFor(error).password;
          if (message) setError("password", { type: "server", message });
        },
      },
    );
  });

  const banner = bannerMessage(reset.error);

  return (
    <AuthCard
      headline="Choose a new password"
      subtitle="This signs you out everywhere else, on every device."
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-[22px]">
        {banner ? <AuthErrorBanner message={banner} /> : null}

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-[7px]">
            <Label htmlFor="reset-password" className="text-[13px]">
              New password
            </Label>
            <Input
              {...register("password")}
              id="reset-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={
                errors.password ? "reset-password-error" : "reset-password-hint"
              }
              className="h-11 rounded-[10px] bg-card dark:bg-card"
            />
            {errors.password ? (
              <p id="reset-password-error" className="text-destructive text-xs">
                {errors.password.message}
              </p>
            ) : (
              <p id="reset-password-hint" className="text-muted-3 text-xs">
                At least 8 characters.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-[7px]">
            <Label htmlFor="reset-confirm-password" className="text-[13px]">
              Confirm password
            </Label>
            <Input
              {...register("confirmPassword")}
              id="reset-confirm-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={errors.confirmPassword ? true : undefined}
              aria-describedby={
                errors.confirmPassword ? "reset-confirm-error" : undefined
              }
              className="h-11 rounded-[10px] bg-card dark:bg-card"
            />
            {errors.confirmPassword ? (
              <p id="reset-confirm-error" className="text-destructive text-xs">
                {errors.confirmPassword.message}
              </p>
            ) : null}
          </div>
        </div>

        <Button
          type="submit"
          disabled={reset.isPending}
          className="h-11 w-full rounded-[10px] text-sm"
        >
          {reset.isPending ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </AuthCard>
  );
}
