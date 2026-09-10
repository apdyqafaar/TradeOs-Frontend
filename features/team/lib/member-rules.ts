import type { ObjectId } from "@/lib/api/types";
import type { ListedMember } from "../types";

/**
 * The four refusals the API makes about *which member* a control may target,
 * expressed once so the row menu can hide an action rather than offer a 403.
 *
 * Every rule here mirrors a guard in `member.service.ts` and each one is a real
 * response, not a guess:
 *
 *   - 403 `"The owner's role cannot be changed"` (`:276-278`)
 *   - 403 `"The owner cannot be removed from their own business"` (`:300-302`)
 *   - 403 `"You cannot remove yourself"` (`:304-306`)
 *   - 409 `"That member has already accepted their invitation"` on a resend to
 *     anyone who is not `invited` (`:200-202`)
 *
 * **These are hints, not enforcement.** The API is the only thing that decides;
 * these exist so a menu does not offer an action that can only fail. The
 * dialogs still branch on the real response, because a role can change between
 * the render and the click.
 */

/**
 * Is this row the organization's owner?
 *
 * The server matches on `Organization.ownerId`, which **is not on the wire** —
 * `GET /auth/me` returns the organization without it, and no member field
 * carries it. So this infers ownership from the role, which is sound for one
 * specific reason: the Owner preset **cannot be assigned to anybody**
 * (`resolveAssignableRole` answers 403, `member.service.ts:43-45`), a custom
 * role can never be *named* "owner" in any casing (reserved, 409), and the
 * owner's own row is created holding it at organization creation
 * (`organization.service.ts:140-149`). So exactly one member in a business
 * holds a role named Owner, and it is the owner.
 *
 * Matched on the name rather than an id because the member row carries only
 * `role: { id, name }` — the id would have to be looked up from `GET /roles`,
 * which the members screen does load, but a Seller reading a members table does
 * not hold `roles:view` and would then be unable to tell who the owner is.
 *
 * If the backend ever grows an ownership-transfer endpoint this stops being
 * sound — but there is none today, and `ownerId` has exactly one writer in the
 * whole of `src` (`docs/contracts/team.md` §10).
 */
export const isOwnerMember = (member: ListedMember): boolean =>
  member.role?.name.trim().toLowerCase() === "owner";

/**
 * Is this row the person looking at the screen?
 *
 * Matched on **`user.id`**, not on a member id: `GET /auth/me` does not return
 * the caller's own member id at all (`auth.controller.ts:94-107`), so there is
 * no member-level identity to compare. A pending row has `user: null` and can
 * never be the caller — an invited member cannot sign in.
 */
export const isSelfMember = (
  member: ListedMember,
  sessionUserId: ObjectId | undefined,
): boolean => Boolean(sessionUserId) && member.user?.id === sessionUserId;

/** A member whose invitation is outstanding — the only row a resend accepts. */
export const isPendingMember = (member: ListedMember): boolean =>
  member.status === "invited";

/**
 * Can this member's role be changed at all?
 *
 * Only the owner is protected. Notably **the caller is not**: there is no
 * self-check on `PATCH /members/:id`, so a manager holding `members:update`
 * genuinely can demote themselves and lose the screen on their next request.
 * That is a real capability rather than an oversight to paper over here, so the
 * control stays — `ChangeRoleDialog` warns when the target is the caller.
 */
export const canChangeRoleOf = (member: ListedMember): boolean =>
  !isOwnerMember(member);

/**
 * Can this member be removed?
 *
 * The owner cannot, and neither can the caller themselves. The server checks
 * the owner first, so a manager targeting the owner gets the owner message and
 * not the self one — the order matters only to the copy, and this returns a
 * single boolean because the menu either offers the item or does not.
 */
export const canRemoveMember = (
  member: ListedMember,
  sessionUserId: ObjectId | undefined,
): boolean => !isOwnerMember(member) && !isSelfMember(member, sessionUserId);

/**
 * The identity to render for a row: the person's name, or the address the
 * invitation went to.
 *
 * A pending row has `user: null` and `invitedEmail` is the whole identity. A
 * **re-invited former member** has both — their row was updated in place and
 * kept its `userId` — and the real name wins there.
 */
export const memberPrimaryLabel = (member: ListedMember): string =>
  member.user?.name ?? member.invitedEmail ?? "Unknown member";

/**
 * The secondary line under the name: the email, when it is not already the
 * primary line.
 *
 * Returns `null` for a pending row whose address is the headline, so the table
 * does not print the same string twice.
 */
export const memberSecondaryLabel = (member: ListedMember): string | null => {
  if (member.user) return member.user.email;
  return null;
};

/**
 * Two letters for the avatar fallback, from whatever identity the row has.
 *
 * Built from the primary label so a pending row gets initials from its address
 * rather than an empty circle. Non-letters are dropped first, so
 * `"leyla@spark.co.ke"` gives `LE` and not `L@`.
 */
export const memberInitials = (member: ListedMember): string => {
  const label = memberPrimaryLabel(member);
  const words = label
    .split(/[\s@._-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};
