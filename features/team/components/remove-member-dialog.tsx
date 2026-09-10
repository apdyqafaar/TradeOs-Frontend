"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import { useRemoveMember } from "../hooks/use-member-mutations";
import { isPendingMember, memberPrimaryLabel } from "../lib/member-rules";
import type { ListedMember } from "../types";

const PANEL =
  "rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong";

/**
 * Confirm removing a member, or cancelling their invitation.
 *
 * **One endpoint, two stories, and the copy has to tell the right one.**
 * `DELETE /members/:id` deactivates: the row survives with `status: "removed"`,
 * keeps its `userId` so past sales stay attributable, and **every session that
 * person holds is revoked on the spot** — their next request is a 401
 * (`manage.test.ts:459-491`). For a pending row it is simply the cancel button,
 * with no session to revoke and nothing to attribute.
 *
 * Saying "delete" would be wrong twice over: nothing is deleted, and the person
 * is not erased from the history the business will read next month.
 *
 * **It is not undoable from this screen**, and the dialog says so plainly. The
 * way back is a fresh invitation, which reactivates the very same row rather
 * than creating a second one (`member.actions.ts:155-169`) — so nobody loses
 * their history by being removed and re-hired.
 *
 * Two of the four refusals are shown here rather than prevented, even though
 * `canRemoveMember` already hides the menu item for both: a role can change
 * between the render and the click, and a 403 with no explanation on an
 * irreversible-looking action is the worst possible outcome.
 */
export interface RemoveMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: ListedMember;
}

export function RemoveMemberDialog({
  open,
  onOpenChange,
  member,
}: RemoveMemberDialogProps) {
  const mutation = useRemoveMember();
  const [refusal, setRefusal] = useState<string | null>(null);

  // Cleared on the way in, never on the way out: clearing on close would wipe
  // the message under the closing animation, and a dialog reopened after a
  // refusal must not still be showing the last attempt's.
  useEffect(() => {
    if (!open) return;
    setRefusal(null);
  }, [open]);

  const pending = isPendingMember(member);
  const label = memberPrimaryLabel(member);

  const submit = () => {
    setRefusal(null);
    mutation.mutate(member.id, {
      onSuccess: () => onOpenChange(false),
      onError: (error: ApiError) => {
        // Branch on `code`. The three that matter here are all 403/409 with a
        // message written for a person to read; the API's own words are used
        // where they are already the clearest available, which is most of them.
        if (error.code === API_ERROR_CODE.FORBIDDEN) {
          // "You cannot remove yourself" and "The owner cannot be removed from
          // their own business" both land here, and both say exactly what
          // happened. A permission failure lands here too and says "You do not
          // have permission to do that", which is equally right.
          setRefusal(error.message);
          return;
        }
        if (error.code === API_ERROR_CODE.CONFLICT) {
          setRefusal(
            "They have already been removed. Refresh to see the current team.",
          );
          return;
        }
        setRefusal(error.message);
      },
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[460px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-serif text-2xl leading-tight text-foreground">
            {pending
              ? `Cancel the invitation to ${label}?`
              : `Remove ${label}?`}
          </Dialog.Title>

          <Dialog.Description className="text-[13px] text-muted-foreground">
            {pending
              ? "Their invitation link stops working straight away. You can invite them again later."
              : "They are signed out everywhere immediately and lose access to this business. Sales and payments they recorded stay in the books under their name. To bring them back, invite them again."}
          </Dialog.Description>

          {refusal ? (
            <p role="alert" className={PANEL}>
              {refusal}
            </p>
          ) : null}

          <div className="flex justify-end gap-2.5">
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              Keep them
            </Button>
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={submit}
            >
              {pending ? "Cancel invitation" : "Remove"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
