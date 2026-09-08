"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/config/routes";
import { AuthCard } from "@/features/auth/components/auth-card";
import { AuthErrorBanner } from "@/features/auth/components/auth-error-banner";
import { CheckEmailPanel } from "@/features/auth/components/check-email-panel";
import { useRegister } from "@/features/auth/hooks/use-register";
import {
  type RegisterInput,
  registerSchema,
} from "@/features/auth/schemas/auth.schema";
import type { ApiError } from "@/lib/api/errors";
import { API_ERROR_CODE, fieldErrorsFor } from "@/lib/api/errors";

/** The three fields the form owns; anything else in a 422 goes to the banner. */
const FIELDS = ["name", "email", "password"] as const;

/**
 * The one 409 `POST /auth/register` can answer with.
 *
 * There is no `DUPLICATE_EMAIL` code — `Backend/src/services/auth.service.ts:102`
 * throws a bare `ConflictError`, whose default code is `"CONFLICT"` — and a
 * taken address is the only conflict registration has, so the status is enough
 * to attribute it to the email field. The message is written here rather than
 * echoed from the API because it belongs under an input, not in a banner.
 */
const EMAIL_TAKEN = "An account with that email already exists.";

/**
 * What the banner says for a failure no input can own.
 *
 * Branches on `code`, never on `message`. `CONFLICT` is absent on purpose:
 * `onError` puts it on the email field, and repeating it up here would say the
 * same thing twice.
 */
function bannerMessage(error: ApiError | null): string | null {
  if (!error) return null;
  // A 422 was already written onto the inputs by `onError` below.
  if (Object.keys(error.fieldErrors ?? {}).length > 0) return null;

  switch (error.code) {
    case API_ERROR_CODE.CONFLICT:
      return null;
    case API_ERROR_CODE.TOO_MANY_REQUESTS:
      // `/register` allows 20 per hour per IP, which a shared office NAT can
      // reach honestly (`Backend/src/routes/v1/auth.route.ts:74`).
      return "Too many attempts — try again later.";
    default:
      return error.message;
  }
}

/**
 * Create an account (undesigned; artboard `1f`'s conventions).
 *
 * Registration creates a **person**, not a business: the response carries the
 * user and nothing else, and `POST /organizations` is the separate second
 * step. So there is no redirect on success — the caller is handed the address
 * and swaps in the check-your-email panel, because the very next thing that
 * matters is the link now sitting in the user's inbox. Creating a business is
 * gated on having clicked it.
 */
export function RegisterForm({
  onRegistered,
}: {
  /** Called with the address the API actually stored, on a 201. */
  onRegistered: (email: string) => void;
}) {
  const register = useRegister();

  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const onError = (error: ApiError) => {
    const fields = fieldErrorsFor(error);
    let attributed = false;
    for (const name of FIELDS) {
      const message = fields[name];
      if (message) {
        setError(name, { type: "server", message });
        attributed = true;
      }
    }
    // A duplicate address arrives as a 409 with no `errors` map, so nothing
    // above catches it. It is unambiguously about the email input.
    if (!attributed && error.code === API_ERROR_CODE.CONFLICT) {
      setError("email", { type: "server", message: EMAIL_TAKEN });
    }
  };

  const onSubmit = handleSubmit((values) => {
    register.mutate(values, {
      // `result.user.email` rather than what was typed: it is the address the
      // API stored and mailed the link to, so the panel names the inbox the
      // user should actually open.
      onSuccess: (result) => onRegistered(result.user.email),
      onError,
    });
  });

  const banner = bannerMessage(register.error);
  const passwordHelpId = errors.password
    ? "register-password-error"
    : "register-password-hint";

  return (
    // `noValidate`: the browser's own bubble on `type="email"` would preempt
    // the resolver and the user would never see the form's message.
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-[22px]">
      {banner ? <AuthErrorBanner message={banner} /> : null}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-[7px]">
          <Label htmlFor="register-name" className="text-[13px]">
            Name
          </Label>
          <Input
            {...field("name")}
            id="register-name"
            type="text"
            autoComplete="name"
            autoFocus
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "register-name-error" : undefined}
            className="h-11 rounded-[10px] bg-card dark:bg-card"
          />
          {errors.name ? (
            <p id="register-name-error" className="text-destructive text-xs">
              {errors.name.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-[7px]">
          <Label htmlFor="register-email" className="text-[13px]">
            Email
          </Label>
          <Input
            {...field("email")}
            id="register-email"
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "register-email-error" : undefined}
            className="h-11 rounded-[10px] bg-card dark:bg-card"
          />
          {errors.email ? (
            <p id="register-email-error" className="text-destructive text-xs">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-[7px]">
          <Label htmlFor="register-password" className="text-[13px]">
            Password
          </Label>
          <Input
            {...field("password")}
            id="register-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={passwordHelpId}
            className="h-11 rounded-[10px] bg-card dark:bg-card"
          />
          {/* The hint and the error occupy the same slot: once the message
              says "at least 8 characters", a grey line repeating it is noise —
              and two elements saying it would make `aria-describedby` point at
              a duplicate. */}
          {errors.password ? (
            <p
              id="register-password-error"
              className="text-destructive text-xs"
            >
              {errors.password.message}
            </p>
          ) : (
            <p id="register-password-hint" className="text-muted-3 text-xs">
              At least 8 characters.
            </p>
          )}
        </div>
      </div>

      <Button
        type="submit"
        disabled={register.isPending}
        className="h-11 w-full rounded-[10px] text-sm"
      >
        {register.isPending ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}

/**
 * The two states `/register` can be in, and the switch between them.
 *
 * This wrapper is what makes `page.tsx` able to stay a Server Component with
 * its own `metadata`: a `"use client"` file cannot export one, and the whole
 * screen hinges on a single piece of client state. The headline changes with
 * that state, so `AuthCard` sits inside the boundary rather than above it.
 */
export function RegisterFlow() {
  const [email, setEmail] = useState<string | null>(null);

  if (email !== null) return <CheckEmailPanel email={email} />;

  return (
    <AuthCard
      headline="Create your account."
      subtitle="One login for you. Your business is the next step."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={ROUTES.login}
            className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm onRegistered={setEmail} />
    </AuthCard>
  );
}
