"use client";

import type { ObjectId } from "@/lib/api/types";
import type { ListedMember } from "../types";
import { useMemberDirectory } from "./use-member-directory";

/**
 * Resolve a **Member** id to the person's display name.
 *
 * ## Why this exists
 *
 * Four screens render a literal em dash where a person's name belongs, because
 * the row they are rendering carries a bare Member id and nothing in the app
 * could turn it into a name:
 *
 *   - `features/sales/components/sale-table.tsx` — `soldBy` and `voidedBy`
 *   - `features/products/components/stock-movements-table.tsx` — `createdBy`
 *   - `features/product-import/hooks/use-import-jobs.ts` — `createdBy`
 *
 * `GET /members` is the missing lookup table and **the join key lines up
 * exactly**: list rows are keyed by `member.id`, and `sale.soldBy` is a
 * `ref: "Member"` id (`docs/contracts/team.md` §6). One request per session
 * resolves all four columns.
 *
 * ## The two limits, both real, both from source
 *
 * **A removed member cannot be resolved, ever.** `GET /members` filters
 * `status: { $ne: "removed" }` in the query itself, there is no `?status=`
 * override, and there is no `GET /members/:id` to reach one by id
 * (`member.actions.ts:21-24`; `docs/contracts/team.md` T3). So a sale rung up
 * by someone who has since left the business has no row to join against — and
 * **the em dash those screens already render stays correct for that case.**
 * That is the honest answer, not a gap to paper over: the alternative would be
 * inventing a name for a person the API deliberately will not name. `resolve`
 * returns `null` there and `display` returns `UNKNOWN_MEMBER`, which is that
 * same dash.
 *
 * **A pending member has `user: null`**, because no `User` document exists
 * until they accept. Their identity is `invitedEmail`, which is what this
 * resolves to. In practice they cannot appear as a `soldBy` — an invited member
 * cannot sign in, so they cannot record anything — but they are rows in the
 * members table itself, and a table that cannot name half its rows is the
 * problem this hook was written to fix.
 *
 * One further case that looks like a bug and is not: a **re-invited former
 * member** is an `invited` row that still carries a populated `user`, because
 * the re-invite updates the existing row and keeps its `userId`
 * (`invite.test.ts:311-368`). Their real name is available, so it wins over the
 * invited address.
 *
 * ## Permission
 *
 * `GET /members` is gated on `members:view`, which **every preset holds**,
 * Seller included (`permissions.ts:126`). So the counter staff who need to see
 * who recorded a sale can build this map. A custom role without `members:view`
 * gets a 403; `isError` goes true, `resolve` answers `null`, and the dash
 * stays. Nothing throws and no screen breaks.
 */

/**
 * What an unresolvable member id renders as: the em dash those four screens
 * already show. Exported so a caller can compare against it rather than
 * hardcoding a character that is easy to type as a hyphen by mistake.
 */
export const UNKNOWN_MEMBER = "—";

export interface MemberNames {
  /**
   * The person's display name, or `null` when the id cannot be resolved —
   * removed, from another tenant, or simply not a member id. Callers that want
   * their own fallback copy use this; callers happy with the dash use
   * `display`.
   */
  resolve: (memberId: ObjectId | null | undefined) => string | null;
  /** `resolve`, with `UNKNOWN_MEMBER` in place of `null`. */
  display: (memberId: ObjectId | null | undefined) => string;
  /** True until the directory has arrived. Render a skeleton, not a dash. */
  isLoading: boolean;
  /**
   * The directory could not be fetched — most likely a 403 from a custom role
   * without `members:view`. Every `resolve` answers `null`, which is the same
   * behaviour the screens had before this hook existed.
   */
  isError: boolean;
}

/**
 * The name to show for one row.
 *
 * Order matters and is not arbitrary: a real name beats an email address, and
 * the only row that can offer both is a re-invited former member, for whom the
 * name is the better identity. An `invited` row with no `user` has nothing else
 * to offer, so the address is the identity rather than a fallback.
 *
 * The final `null` is defensive: `user: null` with no `invitedEmail` is not
 * reachable through any documented path — an invited row always has the
 * address, an active row always has the user — but the two fields are
 * independent on the wire and a row with neither would otherwise render the
 * string `"undefined"`.
 */
export const memberDisplayName = (member: ListedMember): string | null =>
  member.user?.name ?? member.invitedEmail ?? null;

/**
 * `useMemberNames()` — id to name, for any screen holding a Member id.
 *
 * Reads the shared directory query (`useMemberDirectory`), so ten tables asking
 * at once cost one request and the roles screen's member counts are derived
 * from the very same snapshot.
 *
 * Rows this cannot name are **omitted from the map entirely** rather than
 * stored as an empty string, so `resolve` can never answer `""` — a blank cell
 * reads as a nameless person, where the dash reads as an unknown one.
 */
export function useMemberNames(): MemberNames {
  const directory = useMemberDirectory();

  const names = new Map<ObjectId, string>();
  for (const member of directory.data ?? []) {
    const name = memberDisplayName(member);
    if (name) names.set(member.id, name);
  }

  const resolve = (memberId: ObjectId | null | undefined): string | null => {
    if (!memberId) return null;
    return names.get(memberId) ?? null;
  };

  return {
    resolve,
    display: (memberId) => resolve(memberId) ?? UNKNOWN_MEMBER,
    isLoading: directory.isPending,
    isError: directory.isError,
  };
}
