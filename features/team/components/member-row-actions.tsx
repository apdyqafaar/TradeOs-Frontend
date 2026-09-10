"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCan } from "@/features/auth/hooks/use-permission";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { useResendInvite } from "../hooks/use-member-mutations";
import {
  canRemoveMember,
  isPendingMember,
  memberPrimaryLabel,
} from "../lib/member-rules";
import type { ListedMember } from "../types";
import { RemoveMemberDialog } from "./remove-member-dialog";

/**
 * The row overflow menu — the `⋯` at the end of every members row in artboard
 * `2j` (`docs/design/TradeOs-UI.dc.html:1246`).
 *
 * At most two items, and both can be absent:
 *
 *   - **Resend invitation** — pending rows only, and only with `members:invite`
 *     **and a verified email**. A resend to anyone who is not `invited` is a
 *     409, so the item does not exist on an active row.
 *   - **Remove / Cancel invitation** — one action with two names, because it is
 *     genuinely one endpoint. `DELETE /members/:id` deactivates an active
 *     member and cancels a pending invitation, and there is no separate
 *     cancel-invite route.
 *
 * When both are absent the trigger is not rendered at all, so a row whose only
 * possible action is a refusal shows an empty cell rather than a menu with
 * nothing in it.
 *
 * **Resend reports through a toast, and that is a considered exception** to
 * this repo's "show the failure where the action was taken" rule. The action
 * lives inside a menu that closes on click, so there is no control left on
 * screen to attach a message to — and the same pattern is already established
 * for the other mail-sending action in the app
 * (`features/auth/hooks/use-resend-verification.ts`). Removal, which has real
 * per-member refusals to explain, gets a dialog instead.
 *
 * The success copy deliberately does not promise delivery: **an invite whose
 * email fails to send still answers 200/201** (`member.service.ts:180-185`), so
 * "Invitation resent" is a statement about the request, not the inbox.
 */
export interface MemberRowActionsProps {
  member: ListedMember;
  /** The signed-in user's id — `user.id`, not a member id. See `isSelfMember`. */
  sessionUserId: ObjectId | undefined;
}

export function MemberRowActions({
  member,
  sessionUserId,
}: MemberRowActionsProps) {
  const canInvite = useCan(PERMISSIONS.MEMBERS_INVITE);
  const canRemove = useCan(PERMISSIONS.MEMBERS_REMOVE);
  const resend = useResendInvite();
  const [removing, setRemoving] = useState(false);

  const showResend = canInvite && isPendingMember(member);
  const showRemove = canRemove && canRemoveMember(member, sessionUserId);

  if (!showResend && !showRemove) return null;

  const label = memberPrimaryLabel(member);

  const doResend = () => {
    resend.mutate(member.id, {
      onSuccess: () => {
        toast.success("Invitation resent", {
          description: `A fresh link is on its way to ${label}. The previous link no longer works.`,
        });
      },
      onError: (error: ApiError) => {
        // Branch on `code`, never on `message`. Two of these are worth their
        // own words; the rest are already clearer from the API than anything
        // this component could invent.
        if (error.code === API_ERROR_CODE.EMAIL_NOT_VERIFIED) {
          toast.error("Confirm your own email address first", {
            description:
              "Invitations are sent from your address, so it has to be verified. Check your inbox for the link.",
          });
          return;
        }
        if (error.code === API_ERROR_CODE.CONFLICT) {
          toast.error("Nothing to resend", {
            description:
              "That invitation has already been accepted, or the member was removed. Refresh to see where they stand.",
          });
          return;
        }
        toast.error("Could not resend the invitation", {
          description: error.message,
        });
      },
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${label}`}
            >
              <MoreHorizontal />
            </Button>
          }
        />

        <DropdownMenuContent align="end" className="min-w-48">
          {showResend ? (
            <DropdownMenuItem disabled={resend.isPending} onClick={doResend}>
              Resend invitation
            </DropdownMenuItem>
          ) : null}

          {showResend && showRemove ? <DropdownMenuSeparator /> : null}

          {showRemove ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setRemoving(true)}
            >
              {isPendingMember(member)
                ? "Cancel invitation"
                : "Remove from business"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {showRemove ? (
        <RemoveMemberDialog
          open={removing}
          onOpenChange={setRemoving}
          member={member}
        />
      ) : null}
    </>
  );
}
