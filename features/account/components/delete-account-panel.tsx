"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { useDeleteAccount } from "@/features/account/hooks/use-account-mutations";
import { useSession } from "@/features/auth/hooks/use-session";
import { deleteAccountSchema } from "@/features/auth/schemas/auth.schema";
import {
  AlertNote,
  CONTROL,
  Field,
} from "@/features/settings/components/form-primitives";
import { API_ERROR_CODE } from "@/lib/api/errors";

/**
 * "Delete account" — artboard `2k`
 * (`docs/design/TradeOs-UI.dc.html:1460-1466`).
 *
 * ## An owner can never delete their own account, so no owner sees a button
 *
 * `DELETE /auth/account` refuses with **409 `OWNS_ORGANIZATION`** whenever
 * `countOrganizationsOwnedBy(userId) > 0`, checked once before the transaction
 * and again inside it (`auth.service.ts:698-699,760,769-771`). The message says
 * to transfer ownership first — and **there is no ownership-transfer endpoint
 * anywhere in this API**: no `POST /organizations/current/transfer`, and
 * `ownerId` is not writable on any schema (`docs/contracts/settings-account.md`
 * §7). `createOrganizationForUser` makes the creator the owner and enforces one
 * business per person, so the first user of every tenant is permanently in this
 * state.
 *
 * A button that always 409s is not a feature, it is a trap: the person types
 * their password, waits, and is told to do something the product cannot do. So
 * an owner gets the explanation **where the control would have been**, which is
 * what the contract asks for, and the destructive action is not rendered at
 * all. The API's own test proves the refusal changes literally nothing — user,
 * credentials, session and membership all intact afterwards
 * (`account.test.ts:396-414`) — so nothing is lost by not offering it.
 *
 * **Ownership is read from the session's role name.** `GET /auth/me` returns
 * `role: { id, name }` and no `ownerId` (`auth.controller.ts:94-107`), so
 * `name === "Owner"` is the only signal available client-side. It is a good one
 * — `"Owner"` is a reserved preset name that no custom role may take — but it
 * is still a hint, not the gate. The 409 is the gate, and it is handled below
 * for the case where this hint is somehow wrong.
 */
const OWNER_ROLE = "Owner";

export function DeleteAccountPanel() {
  const session = useSession();
  const [open, setOpen] = useState(false);

  if (!session.data) return null;

  const isOwner = session.data.role?.name === OWNER_ROLE;

  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-destructive/30 bg-destructive-soft p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-medium text-destructive-strong text-sm">
            Delete account
          </h3>
          <p className="text-[13px] text-destructive-strong/85">
            {isOwner
              ? "You own this business, so your account cannot be deleted."
              : "This removes your sign-in permanently. It cannot be undone."}
          </p>
        </div>

        {isOwner ? null : (
          <Button
            variant="destructive"
            className="flex-none"
            onClick={() => setOpen(true)}
          >
            Delete account
          </Button>
        )}
      </div>

      {isOwner ? (
        <p className="text-[13px] text-destructive-strong/85">
          TradeOs has no way to hand a business to another member yet, and an
          account that owns one cannot be removed. Nothing you can do on this
          screen will change that — if you need the business closed or moved,
          ask TradeOs support rather than trying here.
        </p>
      ) : (
        <p className="text-[13px] text-destructive-strong/85">
          Your record in {session.data.organization?.name ?? "the business"}{" "}
          stays readable to your teammates so past sales keep their author, but
          your sign-in, your password and every device you are signed in on go
          immediately. The email address becomes free to register again straight
          away.
        </p>
      )}

      {isOwner ? null : (
        <DeleteAccountDialog open={open} onOpenChange={setOpen} />
      )}
    </section>
  );
}

function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const uid = useId();
  const session = useSession();
  const mutation = useDeleteAccount();

  const [password, setPassword] = useState("");
  const [typedEmail, setTypedEmail] = useState("");
  const [issue, setIssue] = useState<string | null>(null);

  const email = session.data?.user.email ?? "";

  // Re-seeded on the way in, never on the way out: clearing on close would
  // empty the fields under the closing animation. Clearing the password on the
  // way in also means a dialog reopened after a refusal is not still holding
  // the credential that was refused.
  useEffect(() => {
    if (!open) return;
    setPassword("");
    setTypedEmail("");
    setIssue(null);
    mutation.reset();
  }, [open, mutation.reset]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    // Purely client-side: there is no `confirm` field and no typed-name field
    // on `deleteAccountSchema` — the API asks for the password and nothing
    // else. This exists to make the action deliberate, so it is checked here
    // and never sent.
    if (typedEmail.trim().toLowerCase() !== email.toLowerCase()) {
      setIssue("Type your email address exactly to confirm.");
      return;
    }

    const parsed = deleteAccountSchema.safeParse({ currentPassword: password });
    if (!parsed.success) {
      setIssue(parsed.error.issues[0]?.message ?? "Your password is required.");
      return;
    }

    setIssue(null);
    mutation.mutate(parsed.data, {
      onSuccess: () => {
        // The cookie is cleared server-side and the user row is hard-deleted,
        // so there is no session left to route with. A full navigation drops
        // every module and cache in the tab, which is the honest end state.
        window.location.assign(ROUTES.login);
      },
      onError: (error) => {
        // The hint in the panel above said this person is not an owner. If the
        // API disagrees, the API is right — say what it said, and stop
        // offering the action.
        if (error.code === API_ERROR_CODE.CONFLICT) {
          setIssue(error.message);
          return;
        }
        setIssue(error.message);
      },
    });
  };

  const busy = mutation.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[460px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-serif text-2xl text-foreground leading-tight">
            Delete your account
          </Dialog.Title>

          <Dialog.Description className="text-[13px] text-muted-foreground">
            This is immediate and permanent. There is no recovery window and no
            retained copy — the address becomes available to register again
            straight away.
          </Dialog.Description>

          <form onSubmit={submit} className="flex flex-col gap-3.5">
            <Field
              id={`${uid}-email`}
              label={`Type ${email} to confirm`}
              error={undefined}
            >
              {(props) => (
                <input
                  {...props}
                  type="email"
                  value={typedEmail}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(event) => setTypedEmail(event.target.value)}
                  className={CONTROL}
                />
              )}
            </Field>

            <Field id={`${uid}-password`} label="Your password">
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

            {issue ? <AlertNote>{issue}</AlertNote> : null}

            <div className="flex justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={busy}>
                {busy ? "Deleting…" : "Delete my account"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
