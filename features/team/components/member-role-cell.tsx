"use client";

import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import { useChangeMemberRole } from "../hooks/use-member-mutations";
import { canChangeRoleOf, isOwnerMember } from "../lib/member-rules";
import type { ListedMember, Role } from "../types";

/**
 * The Role cell of the members table — artboard `2j`
 * (`docs/design/TradeOs-UI.dc.html:1236-1242`), which draws it as a bordered
 * control with a chevron **only on rows that are selectable**.
 *
 * Three renderings, and which one you get is a fact about the row, not a
 * preference:
 *
 *   - **Plain text, no border.** The caller lacks `members:update`, or the
 *     assignable role list could not be loaded (a custom role with
 *     `members:invite` but not `roles:view` can reach this screen), or the row
 *     is the **owner**, whose role is a 403 to change. Hidden, not disabled —
 *     the repo rule, and here it also avoids advertising a control whose only
 *     outcome is a refusal.
 *   - **A dropdown.** Everything else.
 *   - **A dropdown plus an inline refusal**, when the API said no. The message
 *     lands in the cell that caused it rather than in a toast, because it is
 *     always about *this* member.
 *
 * The role is changed on selection with no confirmation step. It is reversible
 * in one click, it revokes nothing, and the API rebuilds permissions from the
 * member row on every request — so a mistake costs the target one wrong page
 * load, not a lost session (`permissions-middleware.test.ts:122-133`).
 *
 * **The response is deliberately thrown away.** `PATCH /members/:id` answers
 * `publicMember` plus `role`, which has no `user` key at all; splicing it into
 * a list row would blank the person's name. `useChangeMemberRole` invalidates
 * the list instead.
 */
export interface MemberRoleCellProps {
  member: ListedMember;
  /**
   * The roles this caller may assign — **Owner already filtered out** by
   * `assignableRoles`. Assigning Owner is a 403, not a 422, so it must never
   * reach the menu.
   */
  roles: Role[];
  /** `members:update`, checked once by the table rather than per row. */
  canUpdate: boolean;
}

export function MemberRoleCell({
  member,
  roles,
  canUpdate,
}: MemberRoleCellProps) {
  const mutation = useChangeMemberRole();
  const [refusal, setRefusal] = useState<string | null>(null);

  const name = member.role?.name ?? "No role";

  // `roles.length === 0` covers both "still loading" and "could not load"; in
  // either case there is nothing to choose from, so the control would be an
  // empty menu. The row falls back to text and gains the chevron when the list
  // arrives.
  const selectable = canUpdate && canChangeRoleOf(member) && roles.length > 0;

  if (!selectable) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-foreground">{name}</span>
        {isOwnerMember(member) && canUpdate ? (
          // Said only to someone who could otherwise have changed it — for
          // anyone else the absence needs no explanation.
          <span className="text-[11px] text-muted-foreground">
            The owner's role is fixed
          </span>
        ) : null}
      </div>
    );
  }

  const choose = (roleId: string) => {
    if (roleId === member.role?.id) return;
    setRefusal(null);

    mutation.mutate(
      { memberId: member.id, input: { roleId } },
      {
        onError: (error: ApiError) => {
          // Branch on `code`, never on `message` (CLAUDE.md). Four different
          // refusals reach this control and each needs its own words; the
          // API's own message is used where it is already the clearest thing
          // anyone could say.
          if (error.code === API_ERROR_CODE.NOT_FOUND) {
            setRefusal(
              "That member or role is no longer there. Refresh and try again.",
            );
            return;
          }
          setRefusal(error.message);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={mutation.isPending}
          className={cn(
            "flex h-8 w-full items-center justify-between gap-2 rounded-[9px] border border-border bg-card px-2.5 text-[13px] text-foreground transition-colors",
            "hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            mutation.isPending && "opacity-60",
          )}
          aria-label={`Change role for ${member.user?.name ?? member.invitedEmail ?? "this member"}`}
        >
          <span className="truncate">{name}</span>
          <ChevronDown
            className="size-3.5 flex-none text-muted-foreground"
            aria-hidden="true"
          />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="min-w-44">
          <DropdownMenuRadioGroup
            value={member.role?.id ?? ""}
            onValueChange={choose}
          >
            {roles.map((role) => (
              <DropdownMenuRadioItem key={role.id} value={role.id}>
                {role.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {refusal ? (
        <p role="alert" className="text-[11px] text-destructive">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
