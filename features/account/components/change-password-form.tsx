"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useChangePassword } from "@/features/account/hooks/use-account-mutations";
import { changePasswordSchema } from "@/features/auth/schemas/auth.schema";
import {
  AlertNote,
  CONTROL,
  Field,
  SettingsPanel,
  SuccessNote,
} from "@/features/settings/components/form-primitives";
import { API_ERROR_CODE, fieldErrorsFor } from "@/lib/api/errors";

/**
 * "Password" on the Security tab — artboard `2k`
 * (`docs/design/TradeOs-UI.dc.html:1400-1408`): current, new, confirm, then one
 * primary button.
 *
 * ## What the API does that the copy has to match
 *
 * **The caller stays signed in.** `auth.controller.ts:188-189` deliberately
 * leaves this session's cookie alive and revokes every *other* one, returning
 * `revokedSessions`. Redirecting to `/login` on success — the reflex — would
 * throw the user out of a session the server just went to the trouble of
 * keeping. The success note reports the count instead, which is also the only
 * place the user learns their other devices were signed out.
 *
 * **A wrong current password is a 401 whose body is byte-identical to what
 * `login` answers** — the API's own test compares the two responses directly
 * (`account.test.ts:258-288`). So there is nothing to branch on but the status,
 * and the message is put on the *current password* field, because on this
 * screen that is the only credential it can be about.
 *
 * **`currentPassword` is `min(1)` upstream, not today's policy** — deliberately
 * (`auth.validation.ts:70-73`), so an account created under an older rule can
 * still authenticate. Only `newPassword` carries 8..128.
 *
 * **The rate limit is real here**: 10 attempts / 15 min per IP, which a shared
 * office NAT reaches. A 429 is surfaced with its `Retry-After`-derived message
 * verbatim rather than as "something went wrong".
 *
 * ## Confirm is ours, not the API's
 *
 * There is no `confirmPassword` field upstream. The check is local, and it runs
 * *before* the request so a typo never costs one of the ten attempts.
 *
 * Nothing here is logged and nothing is kept: all three fields are cleared on
 * success, and the mutation is declared `gcTime: 0` so React Query does not
 * hold `{ currentPassword, newPassword }` in its cache — see
 * `hooks/use-account-mutations.ts`.
 */
export function ChangePasswordForm() {
  const uid = useId();
  const mutation = useChangePassword();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [revoked, setRevoked] = useState<number | null>(null);

  const clear = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setRevoked(null);

    if (next !== confirm) {
      setIssues({ confirm: "The two new passwords do not match" });
      return;
    }

    const parsed = changePasswordSchema.safeParse({
      currentPassword: current,
      newPassword: next,
    });

    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        found[field] ??= issue.message;
      }
      setIssues(found);
      return;
    }

    setIssues({});
    mutation.mutate(parsed.data, {
      onSuccess: (data) => {
        // Cleared immediately: three plaintext credentials have no reason to
        // outlive the request that used them.
        clear();
        setRevoked(data.revokedSessions);
      },
      onError: (error) => {
        // A 401 here can only be about the current password — that is the one
        // credential the request carried — and the message is identical to
        // login's, so the field is the only place it makes sense.
        if (error.status === 401) {
          setIssues({ currentPassword: error.message });
          return;
        }

        // "Your new password must be different from your current one."
        if (error.code === API_ERROR_CODE.BAD_REQUEST) {
          setIssues({ newPassword: error.message });
          return;
        }

        const fields = fieldErrorsFor(error);
        setIssues(
          Object.keys(fields).length > 0 ? fields : { form: error.message },
        );
      },
    });
  };

  const busy = mutation.isPending;

  return (
    <SettingsPanel title="Password">
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field
          id={`${uid}-current`}
          label="Current password"
          error={issues.currentPassword}
        >
          {(props) => (
            <input
              {...props}
              type="password"
              value={current}
              disabled={busy}
              autoComplete="current-password"
              onChange={(event) => setCurrent(event.target.value)}
              className={CONTROL}
            />
          )}
        </Field>

        <Field
          id={`${uid}-new`}
          label="New password"
          error={issues.newPassword}
          hint="At least 8 characters."
        >
          {(props) => (
            <input
              {...props}
              type="password"
              value={next}
              disabled={busy}
              autoComplete="new-password"
              onChange={(event) => setNext(event.target.value)}
              className={CONTROL}
            />
          )}
        </Field>

        <Field
          id={`${uid}-confirm`}
          label="Confirm new password"
          error={issues.confirm}
        >
          {(props) => (
            <input
              {...props}
              type="password"
              value={confirm}
              disabled={busy}
              autoComplete="new-password"
              onChange={(event) => setConfirm(event.target.value)}
              className={CONTROL}
            />
          )}
        </Field>

        {issues.form ? <AlertNote>{issues.form}</AlertNote> : null}

        {revoked === null ? null : (
          <SuccessNote>
            Your password has been changed. You are still signed in here
            {revoked > 0
              ? `, and ${revoked} other ${revoked === 1 ? "device was" : "devices were"} signed out.`
              : "; no other devices were signed in."}
          </SuccessNote>
        )}

        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Changing…" : "Change password"}
          </Button>
        </div>
      </form>
    </SettingsPanel>
  );
}
