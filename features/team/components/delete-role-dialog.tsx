"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import { useDeleteRole } from "../hooks/use-role-mutations";
import type { Role } from "../types";

const PANEL =
  "rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong";

/**
 * Delete a custom role.
 *
 * **This one really deletes.** Its sibling `DELETE /members/:id` deactivates
 * and keeps the row; this removes the document from the collection and answers
 * 200 with no `data` key at all. There is no undo and no "archived roles" view
 * to recover from, which is why a role that anybody holds is not offered a
 * delete button in the first place.
 *
 * ## The in-use refusal, and why there is no "reassign" option
 *
 * The server counts members holding the role — `status: { $ne: "removed" }`,
 * the same predicate `GET /members` filters on — and refuses with a 409 whose
 * message names the count: *"This role cannot be deleted: 1 member still has
 * it. Move them to another role first."*
 *
 * **There is no cascade, no reassignment and no "move to default".** The
 * backend says why in the service itself: deleting a role in use would orphan
 * those members' access silently, because `requireMember` resolves `roleId` on
 * every request and would start failing for them the moment it vanished. So the
 * only route through is the one the message describes, and this dialog says the
 * same thing before the request rather than after it — the count is already on
 * screen, derived from the members list with the same predicate the guard uses.
 *
 * The 409 is still handled. The count here is a client-side derivation of a
 * server-side fact and somebody else can assign the role between the render and
 * the click.
 */
export interface DeleteRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role;
  /**
   * How many members hold this role, from `useRoleMemberCounts`. `undefined`
   * when the count is unknown (the directory failed, most likely a 403) — in
   * which case the dialog offers the delete and lets the server decide, rather
   * than blocking on a number it does not have.
   */
  memberCount: number | undefined;
}

export function DeleteRoleDialog({
  open,
  onOpenChange,
  role,
  memberCount,
}: DeleteRoleDialogProps) {
  const mutation = useDeleteRole();
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRefusal(null);
  }, [open]);

  const inUse = memberCount !== undefined && memberCount > 0;

  const submit = () => {
    setRefusal(null);
    mutation.mutate(role.id, {
      onSuccess: () => onOpenChange(false),
      onError: (error: ApiError) => {
        if (error.code === API_ERROR_CODE.CONFLICT) {
          // The server's message names the live count and is written to be read
          // verbatim — it is more accurate than anything derived here, because
          // it was computed at the moment of the attempt.
          setRefusal(error.message);
          return;
        }
        if (error.code === API_ERROR_CODE.NOT_FOUND) {
          setRefusal("That role is already gone. Refresh to see the list.");
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
            {inUse ? `${role.name} is in use` : `Delete ${role.name}?`}
          </Dialog.Title>

          <Dialog.Description className="text-[13px] text-muted-foreground">
            {inUse
              ? `${memberCount === 1 ? "1 member" : `${memberCount} members`} still ${memberCount === 1 ? "has" : "have"} this role. Move ${memberCount === 1 ? "them" : "them all"} to another role on the Members tab, then delete it. Deleting a role people hold would take away their access with nothing to fall back on, so the API refuses it.`
              : "Nobody holds this role, so nothing changes for anyone. It cannot be brought back — you would have to build it again."}
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
              {inUse ? "Close" : "Keep it"}
            </Button>
            {/* Not rendered at all while the role is in use: the only outcome
                would be the 409 already explained above, and a button that can
                only fail is worse than no button. */}
            {inUse ? null : (
              <Button
                variant="destructive"
                disabled={mutation.isPending}
                onClick={submit}
              >
                Delete role
              </Button>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
