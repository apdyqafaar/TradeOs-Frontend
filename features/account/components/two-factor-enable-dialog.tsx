"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QrCode } from "@/features/account/components/qr-code";
import {
  useSetupTwoFactor,
  useVerifyTwoFactor,
} from "@/features/account/hooks/use-two-factor";
import { CodeInput } from "@/features/auth/components/code-input";
import { twoFactorVerifySchema } from "@/features/auth/schemas/auth.schema";
import {
  AlertNote,
  InfoNote,
} from "@/features/settings/components/form-primitives";

const POPUP =
  "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[480px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0";

const BACKDROP =
  "fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0";

/**
 * Turning two-factor on — artboard `2k`
 * (`docs/design/TradeOs-UI.dc.html:1418-1436`): the QR, the manual key, the
 * six code boxes.
 *
 * ## Two steps, and the second one is irreversible in a way the UI must show
 *
 * `POST /auth/2fa/setup` mints a secret with **`enabled: false`** — it does not
 * turn anything on — and `POST /auth/2fa/verify` is what flips the flag and
 * **returns ten recovery codes, once**. They are stored as argon2id hashes
 * (`two-factor.service.ts:127-132`). There is **no endpoint to view them
 * again, no regeneration, and no count-remaining**; `usedAt` exists in the
 * database and is never serialised (contract §4). If the person closes this
 * dialog without writing them down, they are gone for good, and the only
 * remaining way into a lost-phone account is a password reset that does not
 * clear 2FA.
 *
 * So the third step is a hard stop: the codes are shown alone, the dialog's
 * close affordances are replaced by an explicit "I have saved these", and the
 * copy says plainly that this is the only time. Anything softer — a toast, a
 * dismissible banner — loses somebody their account eventually.
 *
 * ## Calling `setup` twice is not free
 *
 * A second `setup` replaces the pending secret and the first stops working
 * (`two-factor-setup.test.ts:110-131`). So it fires **once**, when the dialog
 * opens, and never on a re-render or a failed code — a wrong TOTP is a 401
 * against a secret that is still perfectly good, and re-requesting would
 * silently invalidate the QR the person is mid-scan on.
 */
export function TwoFactorEnableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const uid = useId();
  const setup = useSetupTwoFactor();
  const verify = useVerifyTwoFactor();

  const [code, setCode] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  const { mutate: startSetup, reset: resetSetup } = setup;
  const { reset: resetVerify } = verify;

  // Once per opening. `startSetup`/`reset` are stable mutation methods, so this
  // does not re-run on a render — which matters, because a second `/2fa/setup`
  // would replace the secret behind the QR already on screen.
  useEffect(() => {
    if (!open) return;
    setCode("");
    setIssue(null);
    setCodes(null);
    resetVerify();
    resetSetup();
    startSetup();
  }, [open, startSetup, resetSetup, resetVerify]);

  const submit = () => {
    const parsed = twoFactorVerifySchema.safeParse({ code });
    if (!parsed.success) {
      setIssue(
        parsed.error.issues[0]?.message ??
          "Enter the 6-digit code from your authenticator app",
      );
      return;
    }

    setIssue(null);
    verify.mutate(parsed.data, {
      onSuccess: (data) => {
        setCodes(data.recoveryCodes);
        // The typed TOTP has done its job and is a credential; it does not
        // outlive the request.
        setCode("");
      },
      onError: (error) => {
        setIssue(error.message);
        setCode("");
      },
    });
  };

  const busy = verify.isPending;
  /**
   * While the codes are on screen, nothing closes this dialog except the
   * acknowledgement.
   *
   * `disablePointerDismissal` stops a click outside. Escape and every other
   * route are stopped by the `onOpenChange` guard below: the dialog is
   * *controlled*, so declining to lower `open` simply leaves it open, whatever
   * asked. Both are needed — the prop alone leaves Escape working, and Escape
   * on this screen destroys ten unrecoverable credentials.
   */
  const locked = codes !== null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (locked && !next) return;
        onOpenChange(next);
      }}
      disablePointerDismissal={locked}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={BACKDROP} />
        <Dialog.Popup className={POPUP}>
          {codes ? (
            <RecoveryCodes
              codes={codes}
              onAcknowledge={() => {
                setCodes(null);
                onOpenChange(false);
              }}
            />
          ) : (
            <>
              <Dialog.Title className="font-serif text-2xl text-foreground leading-tight">
                Turn on two-factor authentication
              </Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted-foreground">
                Scan this with your authenticator app, then enter the six-digit
                code it shows.
              </Dialog.Description>

              {setup.isPending ? (
                <div className="flex gap-4">
                  <Skeleton className="size-24 flex-none rounded-lg" />
                  <Skeleton className="h-24 flex-1 rounded-lg" />
                </div>
              ) : setup.error ? (
                <AlertNote>{setup.error.message}</AlertNote>
              ) : setup.data ? (
                <div className="flex flex-wrap gap-4 rounded-[10px] border border-border bg-background p-4">
                  <QrCode value={setup.data.otpauthUri} />
                  <div className="flex min-w-[200px] flex-1 flex-col gap-2">
                    <p className="text-[13px] text-foreground">
                      Scan the code, or enter the key by hand:
                    </p>
                    {/*
                      `select-all` so a tap or a click grabs the whole key —
                      there is no copy button, because a clipboard write puts a
                      TOTP secret somewhere this app cannot clear it from.
                    */}
                    <code className="select-all break-all rounded-lg border border-border bg-muted px-2.5 py-2 font-mono text-[13px] tracking-[0.08em] text-foreground">
                      {setup.data.secret}
                    </code>
                  </div>
                </div>
              ) : null}

              {setup.data ? (
                <div className="flex flex-col gap-2">
                  <CodeInput
                    length={6}
                    value={code}
                    onChange={(next) => {
                      setCode(next);
                      if (issue) setIssue(null);
                    }}
                    label="Six-digit code from your authenticator app"
                    disabled={busy}
                    invalid={issue !== null}
                    describedBy={issue ? `${uid}-error` : undefined}
                  />
                  {issue ? (
                    <p
                      id={`${uid}-error`}
                      className="text-[13px] text-destructive"
                    >
                      {issue}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex justify-end gap-2.5">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={busy || !setup.data || code.length !== 6}
                  onClick={submit}
                >
                  {busy ? "Checking…" : "Turn on"}
                </Button>
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The ten codes, shown once and never again.
 *
 * The checkbox is the point. There is no way to re-display these, so the only
 * protection against someone closing the dialog too fast is making the exit
 * require a deliberate act. It is not busywork — the API genuinely cannot help
 * afterwards.
 */
function RecoveryCodes({
  codes,
  onAcknowledge,
}: {
  codes: string[];
  onAcknowledge: () => void;
}) {
  const uid = useId();
  const [confirmed, setConfirmed] = useState(false);

  return (
    <>
      <Dialog.Title className="font-serif text-2xl text-foreground leading-tight">
        Save your recovery codes
      </Dialog.Title>

      <InfoNote>
        Two-factor authentication is on. These ten codes are the only way back
        in if you lose your phone — each works once.{" "}
        <strong>This is the only time they can be shown.</strong> TradeOs stores
        them scrambled and cannot show them again or issue new ones.
      </InfoNote>

      {/*
        No "download" and no "copy" button. Both would write ten single-use
        credentials somewhere this app cannot clear — the clipboard survives
        the tab, and a download lands in a folder that syncs. Selecting the
        block and writing them down is the honest interaction.
      */}
      <ul className="grid select-all grid-cols-2 gap-1.5 rounded-[10px] border border-border bg-muted p-3.5">
        {codes.map((code) => (
          <li
            key={code}
            className="text-center font-mono text-[13px] tracking-[0.08em] text-foreground"
          >
            {code}
          </li>
        ))}
      </ul>

      <label
        htmlFor={`${uid}-confirm`}
        className="flex items-start gap-2.5 text-[13px] text-foreground"
      >
        <input
          id={`${uid}-confirm`}
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 size-4 flex-none accent-primary"
        />
        I have written these down somewhere safe.
      </label>

      <div className="flex justify-end">
        <Button disabled={!confirmed} onClick={onAcknowledge}>
          Done
        </Button>
      </div>
    </>
  );
}
