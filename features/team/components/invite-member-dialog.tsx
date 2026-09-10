"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import { useInviteMember } from "../hooks/use-member-mutations";
import { inviteMemberSchema } from "../schemas/member.schema";
import type { Role } from "../types";
import { roleSummary } from "./role-summary";

const CONTROL =
  "w-full rounded-[10px] border border-border bg-background px-3 py-2.5 text-sm text-foreground leading-relaxed transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

const PANEL =
  "rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong";

// The design's info panel (`docs/design/TradeOs-UI.dc.html:1315-1318`): a blue
// hairline over a pale blue ground. `--info-strong` is the token pair that is
// legible on `--info-soft` in both themes; `border-info/30` matches how the
// destructive panels in this repo draw their edge, since there is no
// `--info-border`.
const NOTICE =
  "rounded-[10px] border border-info/30 bg-info-soft px-3.5 py-2.5 text-[13px] text-info-strong";

/**
 * "Invite a teammate" — artboard `2j`
 * (`docs/design/TradeOs-UI.dc.html:1271-1288`): an email, a role, a line of
 * help under the role, Cancel and Send invite.
 *
 * ## Every refusal this control has to speak for
 *
 * More than any other dialog in the app, and each one is a different sentence:
 *
 *   - **403 `EMAIL_NOT_VERIFIED`** — the caller's *own* address is unverified.
 *     This is not "ask an owner for access"; it is the only 403 in the system
 *     the person can clear entirely on their own, and it is a completely normal
 *     state for a brand-new owner who has not opened their inbox yet. Branching
 *     on the code and not the message is mandatory here — the backend's own
 *     comment says a frontend that told these apart by reading message text
 *     would break the first time the wording changed.
 *   - **409 self-invite** — "You are already a member of this business."
 *     Refused before any write or mail, and case-insensitive.
 *   - **409 already on TradeOs** — that person holds an active membership
 *     somewhere. One business per person, platform-wide.
 *   - **409 already invited here** — an outstanding invitation exists. Resend
 *     it from their row rather than sending a second.
 *   - **403 the Owner role** — filtered out of the picker below, so this should
 *     be unreachable; handled anyway, because the list is fetched and could in
 *     principle arrive with something unexpected in it.
 *   - **429** — the **business's** hourly quota, not the caller's, shared
 *     between inviting and resending. Somebody else's invitations can spend it.
 *
 * ## And one thing that is not a refusal
 *
 * **A 201 is not proof of delivery.** The mail send is wrapped in a try/catch
 * and a failure is logged and swallowed (`member.service.ts:180-185`), so the
 * dialog's success copy says the invitation was created and points at Resend
 * rather than promising an inbox.
 */
export interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Assignable roles — **Owner already filtered out** by `assignableRoles`. */
  roles: Role[];
  /** True while `GET /roles` is in flight, so the picker can say so. */
  rolesLoading: boolean;
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  roles,
  rolesLoading,
}: InviteMemberDialogProps) {
  const uid = useId();
  const mutation = useInviteMember();

  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [issues, setIssues] = useState<{
    email?: string;
    roleId?: string;
    form?: string;
    unverified?: boolean;
  }>({});

  // Re-seeded on the way in, never on the way out: clearing on close would
  // empty the fields under the closing animation, and a dialog reopened after a
  // refusal must not still hold the address that was refused.
  useEffect(() => {
    if (!open) return;
    setEmail("");
    setRoleId("");
    setIssues({});
  }, [open]);

  const selected = roles.find((role) => role.id === roleId);

  const failed = (error: ApiError) => {
    const fields = fieldErrorsFor(error);

    if (error.code === API_ERROR_CODE.EMAIL_NOT_VERIFIED) {
      setIssues({ unverified: true });
      return;
    }

    // A 422 names the field it is about, and both fields on this form are ones
    // the API validates — put it on the input rather than in the banner.
    if (fields.email || fields.roleId) {
      setIssues({ email: fields.email, roleId: fields.roleId });
      return;
    }

    // Everything else — the four 409s, the Owner 403, a 429 — is already a
    // sentence written for a person to read, and there is nothing this
    // component knows that would improve on it. The one addition is the 429's
    // missing context: the quota is the business's, not yours.
    if (error.status === 429) {
      setIssues({
        form: `${error.message} This limit is shared across everyone in the business and covers resends too.`,
      });
      return;
    }

    setIssues({ form: error.message });
  };

  const submit = () => {
    const parsed = inviteMemberSchema.safeParse({ email, roleId });
    if (!parsed.success) {
      const next: { email?: string; roleId?: string } = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "email") next.email ??= issue.message;
        if (field === "roleId") {
          // The schema's own message names an id format, which is meaningless
          // to somebody who has not picked from a dropdown yet.
          next.roleId ??= roleId ? issue.message : "Pick a role for them";
        }
      }
      setIssues(next);
      return;
    }

    setIssues({});
    mutation.mutate(parsed.data, {
      onSuccess: () => onOpenChange(false),
      onError: failed,
    });
  };

  const busy = mutation.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[440px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-serif text-2xl leading-tight text-foreground">
            Invite a teammate
          </Dialog.Title>

          {issues.unverified ? (
            <div role="alert" className={NOTICE}>
              <p className="font-medium">Confirm your email address first</p>
              <p className="mt-1">
                Invitations are sent on your behalf, so TradeOs needs to know
                the address is yours. Open the link in your inbox, then come
                back — nothing here is lost.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-email`}>Email</Label>
            <input
              id={`${uid}-email`}
              type="email"
              autoComplete="off"
              inputMode="email"
              placeholder="name@business.co.ke"
              value={email}
              disabled={busy}
              aria-invalid={issues.email ? true : undefined}
              aria-describedby={issues.email ? `${uid}-email-error` : undefined}
              onChange={(event) => setEmail(event.target.value)}
              className={CONTROL}
            />
            {issues.email ? (
              <p
                id={`${uid}-email-error`}
                className="text-[13px] text-destructive"
              >
                {issues.email}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-role`}>Role</Label>
            <select
              id={`${uid}-role`}
              value={roleId}
              disabled={busy || rolesLoading || roles.length === 0}
              aria-invalid={issues.roleId ? true : undefined}
              aria-describedby={
                issues.roleId ? `${uid}-role-error` : `${uid}-role-help`
              }
              onChange={(event) => setRoleId(event.target.value)}
              className={cn(CONTROL, "appearance-none")}
            >
              <option value="" disabled>
                {rolesLoading ? "Loading roles…" : "Choose a role"}
              </option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>

            {issues.roleId ? (
              <p
                id={`${uid}-role-error`}
                className="text-[13px] text-destructive"
              >
                {issues.roleId}
              </p>
            ) : (
              <p
                id={`${uid}-role-help`}
                className="text-xs text-muted-foreground"
              >
                {selected
                  ? roleSummary(selected)
                  : // The Owner role is in `GET /roles` and assigning it is a
                    // 403, so it is filtered out of this list upstream. Saying
                    // so here is kinder than leaving someone hunting for it.
                    "Owner cannot be given to anyone — every business has exactly one."}
              </p>
            )}
          </div>

          {issues.form ? (
            <p role="alert" className={PANEL}>
              {issues.form}
            </p>
          ) : null}

          <div className="flex justify-end gap-2.5">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button disabled={busy} onClick={submit}>
              Send invite
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
