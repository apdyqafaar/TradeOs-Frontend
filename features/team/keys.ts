import { createQueryKeys } from "@/lib/query/keys";
import type { MemberListParams } from "./types";

/**
 * Every React Query key this slice uses.
 *
 * Two scopes, not one, because the two lists have genuinely different shapes
 * and different invalidation rules: members are paginated and change on every
 * invite, re-role and removal, while roles are a single unpaginated array that
 * only the roles screen writes to. Folding them together would mean every
 * member mutation discarded the role list as well, and the role list is what
 * fills the assign dropdown on the very screen that just mutated.
 *
 * They do reach across in one direction, and it is not optional: a member's
 * role change moves the **member count** the roles screen renders per role, and
 * `DELETE /roles/:id` is refused with a 409 while any non-removed member still
 * holds the role. So the roles screen counts from the members list, and a
 * member mutation invalidates `memberKeys.lists()`, which is what those counts
 * are derived from. See `hooks/use-role-member-counts.ts`.
 */
const members = createQueryKeys("members");
const roles = createQueryKeys("roles");

export const memberKeys = {
  /** Everything member-shaped. */
  all: members.all,

  /**
   * Every page of the members list.
   *
   * What all four member mutations invalidate, and the only correct response to
   * any of them: the mutation shapes (`publicMember`) carry no `user`, so there
   * is no honest way to patch a cached row from one. A removal also takes a row
   * off the list entirely and moves `meta.total`, and an invite adds one at the
   * end of an oldest-first sort — neither is a patch.
   */
  lists: () => members.lists,

  /**
   * One page under one set of pagination params.
   *
   * Spread rather than passed through: `MemberListParams` is an interface, and
   * an interface has no implicit index signature, so it is not assignable to
   * `QueryKeyParams`. The spread produces an object literal that is.
   */
  list: (params: MemberListParams = {}) => members.list({ ...params }),

  /**
   * The whole directory — every non-removed member, all pages walked, used only
   * by `useMemberNames` to resolve a member id to a person.
   *
   * Deliberately **under the `lists` prefix**, so the four member mutations
   * that invalidate `lists()` reach it too: an invite adds a resolvable id, a
   * removal takes one away, and a name lookup that kept answering after a
   * removal would be worse than one that stops. It is a distinct key rather
   * than a `list({ limit: 100 })` because the data is not one page and a key
   * naming pagination it does not honour is a lie the next reader has to
   * untangle.
   */
  directory: () => [...members.lists, "directory"] as const,
} as const;

export const roleKeys = {
  all: roles.all,

  /**
   * The role list. Wrapped as a function for call-site symmetry even though it
   * takes no arguments — **`GET /roles` accepts no query parameters at all**
   * and is not paginated (`role.route.ts:25-32`), so there is only ever one
   * entry under this key.
   */
  list: () => roles.lists,
} as const;
