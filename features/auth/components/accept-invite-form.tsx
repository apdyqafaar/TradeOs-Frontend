"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/config/routes";
import { AuthErrorBanner } from "@/features/auth/components/auth-error-banner";
import { useAcceptInvite } from "@/features/auth/hooks/use-accept-invite";
import {
  type AcceptInviteInput,
  acceptInviteSchema,
} from "@/features/auth/schemas/auth.schema";
import type { ApiError } from "@/lib/api/errors";
import { API_ERROR_CODE, fieldErrorsFor } from "@/lib/api/errors";

/**
 * The token arrives in the URL, not from the person, so the form owns only the
 * two fields they can actually type. Everything else — bounds, messages — is
 * `acceptInviteSchema` with that one key removed, so the rules stay in one
 * place and cannot drift from the API's validator.
 */
const inviteDetailsSchema = acceptInviteSchema.omit({ token: true });
type InviteDetails = Omit<AcceptInviteInput, "token">;

/** The fields this form renders; a 422 naming anything else goes to the banner. */
const FIELDS = ["name", "password"] as const;

/**
 * True when the API has told us the link itself is spent.
 *
 * `acceptInvite` in `Backend/src/services/auth.service.ts:310` answers every
 * token failure — unknown, wrong type, expired, member already active, member
 * row corrupt — with the same `BadRequestError("This invitation link is
 * invalid or has expired")`, i.e. **400 `BAD_REQUEST`**. It is deliberately one
 * message for all of them so a public endpoint cannot be used to probe tokens,
 * which also means the UI cannot distinguish "expired" from "already used" and
 * must not try. `token` in a 422's field map means the same thing arrived
 * malformed, so it lands here too.
 */
const isSpentInvite = (error: ApiError | null): boolean =>
  error !== null &&
  (error.code === API_ERROR_CODE.BAD_REQUEST ||
    Boolean(error.fieldErrors?.token));

/**
 * What the red banner says for a failure that is neither a field error nor a
 * spent link. Branches on `code`, never on `message`.
 */
function bannerMessage(error: ApiError | null): string | null {
  if (!error) return null;
  if (isSpentInvite(error)) return null;
  // A 422 was already written onto the inputs by `onError`.
  if (Object.keys(error.fieldErrors ?? {}).length > 0) return null;

  if (error.code === API_ERROR_CODE.TOO_MANY_REQUESTS) {
    return "Too many attempts — try again in a few minutes.";
  }
  // Everything left is worth saying in the API's own words: a 409 ("An account
  // with that email already exists") and the 403s for a banned or suspended
  // account are specific facts, and paraphrasing them would only blur them.
  return error.message;
}

/**
 * The calm panel for a link that will never work.
 *
 * Not `AuthErrorBanner`: the person clicked a link from their inbox and did
 * nothing wrong. A red alert would read as an accusation for a state whose only
 * cause is that seven days passed, or that someone else already used the link.
 * Rendered by the page when there is no `?token=` at all, and by the form when
 * the API rejects the one there was.
 */
export function InviteExpiredNotice() {
  return (
    // `<output>` rather than a div with `role="status"`: it carries that role
    // natively, so the swap from the form is announced politely — and because
    // it is phrasing content, its text is a `<span>`, not a `<p>`.
    <output className="flex items-start gap-2.5 rounded-[10px] border border-border bg-card px-3.5 py-3.5">
      <MailX
        aria-hidden="true"
        strokeWidth={1.75}
        className="mt-px size-4 shrink-0 text-muted-foreground"
      />
      <span className="text-[13px] leading-[1.5]">
        That invitation has expired — ask your manager to send a new one.
      </span>
    </output>
  );
}

/**
 * Accepting an invitation (undesigned; artboard `1f` conventions).
 *
 * One submit does everything: creates the account, activates the membership and
 * sets the session cookie. There is no sign-in step afterwards, which is why
 * success pushes straight to the overview.
 */
export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const invite = useAcceptInvite();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<InviteDetails>({
    resolver: zodResolver(inviteDetailsSchema),
    defaultValues: { name: "", password: "" },
  });

  const onError = (error: ApiError) => {
    const fields = fieldErrorsFor(error);
    for (const field of FIELDS) {
      const message = fields[field];
      if (message) setError(field, { type: "server", message });
    }
  };

  const onSubmit = handleSubmit((values) => {
    // The token is a prop, never an input: it identifies the invitation, and
    // putting it in the form would invite a paste of the wrong one.
    invite.mutate(
      { token, name: values.name, password: values.password },
      {
        // The cookie is already set by the time this runs, so the overview
        // will not bounce back to /login.
        onSuccess: () => router.push(ROUTES.overview),
        onError,
      },
    );
  });

  // A spent link cannot be retried with better input, so the fields are
  // replaced rather than left there to be resubmitted into the same 400.
  if (isSpentInvite(invite.error)) return <InviteExpiredNotice />;

  const banner = bannerMessage(invite.error);

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-[22px]">
      {banner ? <AuthErrorBanner message={banner} /> : null}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-[7px]">
          <Label htmlFor="invite-name" className="text-[13px]">
            Your name
          </Label>
          <Input
            {...register("name")}
            id="invite-name"
            autoComplete="name"
            autoFocus
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "invite-name-error" : undefined}
            className="h-11 rounded-[10px] bg-card dark:bg-card"
          />
          {errors.name ? (
            <p id="invite-name-error" className="text-destructive text-xs">
              {errors.name.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-[7px]">
          <Label htmlFor="invite-password" className="text-[13px]">
            Password
          </Label>
          <Input
            {...register("password")}
            id="invite-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={
              errors.password ? "invite-password-error" : "invite-password-hint"
            }
            className="h-11 rounded-[10px] bg-card dark:bg-card"
          />
          {errors.password ? (
            <p id="invite-password-error" className="text-destructive text-xs">
              {errors.password.message}
            </p>
          ) : (
            <p id="invite-password-hint" className="text-muted-3 text-xs">
              At least 8 characters.
            </p>
          )}
        </div>
      </div>

      <Button
        type="submit"
        disabled={invite.isPending}
        className="h-11 w-full rounded-[10px] text-sm"
      >
        {invite.isPending ? "Joining…" : "Join the team"}
      </Button>
    </form>
  );
}
