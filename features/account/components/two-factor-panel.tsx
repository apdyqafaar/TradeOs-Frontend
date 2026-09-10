"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDisableTwoFactor } from "@/features/account/hooks/use-two-factor";
import { useSession } from "@/features/auth/hooks/use-session";
import { twoFactorDisableSchema } from "@/features/auth/schemas/auth.schema";
import {
  AlertNote,
  CONTROL,
  Field,
  InfoNote,
  SettingsPanel,
} from "@/features/settings/components/form-primitives";
import { TwoFactorEnableDialog } from "./two-factor-enable-dialog";

/**
 * "Two-factor authentication" on the Security tab — artboard `2k`
 * (`docs/design/TradeOs-UI.dc.html:1410-1438`).
 *
 * **`GET /auth/me` is the only source of truth.** There is no
 * `GET /auth/2fa/status` anywhere in the API, so `twoFactorEnabled` on the
 * session is what this panel branches on, and every 2FA mutation invalidates
 * that query.
 *
 * ## What this panel deliberately does not show
 *
 * **No "3 of 10 recovery codes remaining".** `usedAt` is tracked per code in
 * the database (`two-factor.model.ts:11-15`) and **is never serialised**
 * anywhere (contract §4), so the number is not knowable from the client. A
 * panel that guessed would be worse than one that stays quiet.
 *
 * **No "show my recovery codes" and no "generate new ones".** Neither endpoint
 * exists. The codes are shown exactly once, at `/2fa/verify`, and are stored as
 * argon2id hashes afterwards. The line under the enabled state says so, because
 * the alternative is somebody looking for a button that is never coming.
 *
 * **Disabling takes a password *and* a code**, deliberately — a session cookie
 * alone is not enough (`two-factor.service.ts:188-213`, with a break-test at
 * `two-factor-setup.test.ts:249-278`). Unlike `/2fa/verify`, the code here may
 * be a TOTP **or** a recovery code, which is the difference that lets somebody
 * who has lost their phone turn it off.
 */
export function TwoFactorPanel() {
  const session = useSession();
  const [enabling, setEnabling] = useState(false);
  const [disabling, setDisabling] = useState(false);

  if (session.isPending) {
    return <Skeleton className="h-[132px] rounded-[10px]" />;
  }

  const enabled = session.data?.twoFactorEnabled ?? false;

  return (
    <SettingsPanel
      title="Two-factor authentication"
      description="A code from your authenticator app at each sign-in."
      action={
        enabled ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-lg bg-success-soft px-2.5 font-medium text-success-strong text-xs">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-success-strong"
            />
            On
          </span>
        ) : (
          <span className="inline-flex h-6 items-center rounded-lg bg-muted px-2.5 font-medium text-muted-foreground text-xs">
            Off
          </span>
        )
      }
    >
      {enabled ? (
        <>
          <InfoNote>
            Your recovery codes were shown once when you turned this on. TradeOs
            keeps them scrambled and cannot show them again or issue new ones —
            if you have lost them, turn two-factor off and on again to get a
            fresh set.
          </InfoNote>

          {disabling ? (
            <DisableForm onDone={() => setDisabling(false)} />
          ) : (
            <div>
              <Button variant="outline" onClick={() => setDisabling(true)}>
                Turn off
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">
            With this on, signing in asks for a six-digit code from your phone
            as well as your password. You will get ten single-use recovery codes
            to keep somewhere safe.
          </p>
          <div>
            <Button onClick={() => setEnabling(true)}>Turn on</Button>
          </div>
          <TwoFactorEnableDialog open={enabling} onOpenChange={setEnabling} />
        </>
      )}
    </SettingsPanel>
  );
}

function DisableForm({ onDone }: { onDone: () => void }) {
  const uid = useId();
  const mutation = useDisableTwoFactor();

  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [issues, setIssues] = useState<Record<string, string>>({});

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    const parsed = twoFactorDisableSchema.safeParse({
      currentPassword: password,
      code,
    });

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        next[field] ??= issue.message;
      }
      setIssues(next);
      return;
    }

    setIssues({});
    mutation.mutate(parsed.data, {
      onSuccess: () => {
        // Both are credentials; neither outlives the request.
        setPassword("");
        setCode("");
        onDone();
      },
      onError: (error) => {
        setPassword("");
        setCode("");
        // A wrong password and a wrong code are both 401, with different
        // messages the client is told never to branch on. There is nothing
        // here that can tell them apart, so the message goes in the banner
        // rather than being guessed onto one of the two fields.
        setIssues({ form: error.message });
      },
    });
  };

  const busy = mutation.isPending;

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3.5 rounded-[10px] border border-border bg-background p-4"
    >
      <p className="text-[13px] text-muted-foreground">
        Turning two-factor off needs your password and one current code — a
        six-digit code from your app, or one of your recovery codes.
      </p>

      <Field
        id={`${uid}-password`}
        label="Your password"
        error={issues.currentPassword}
      >
        {(props) => (
          <input
            {...props}
            type="password"
            value={password}
            disabled={busy}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            className={CONTROL}
          />
        )}
      </Field>

      <Field
        id={`${uid}-code`}
        label="Authenticator or recovery code"
        error={issues.code}
      >
        {(props) => (
          <input
            {...props}
            type="text"
            value={code}
            disabled={busy}
            maxLength={64}
            inputMode="text"
            autoComplete="one-time-code"
            // Recovery codes are `AAAAA-BBBBB` from an alphabet with no I, 1,
            // O, 0 or L, so an autocorrecting keyboard has nothing useful to
            // offer and plenty to break.
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setCode(event.target.value)}
            className={CONTROL}
          />
        )}
      </Field>

      {issues.form ? <AlertNote>{issues.form}</AlertNote> : null}

      <div className="flex gap-2.5">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy ? "Turning off…" : "Turn off two-factor"}
        </Button>
      </div>
    </form>
  );
}
