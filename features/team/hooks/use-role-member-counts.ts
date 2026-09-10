"use client";

import type { ObjectId } from "@/lib/api/types";
import { useMemberDirectory } from "./use-member-directory";

/**
 * How many people hold each role.
 *
 * **There is no endpoint for this.** `GET /roles` answers `publicRole`, which
 * is `{ id, name, description?, permissions, isCustom, isPreset }` and carries
 * no count (`role.controller.ts:9-16`). The number the roles screen shows is
 * derived here from the members directory, which is the same list the members
 * table renders.
 *
 * ## It counts exactly what the delete guard counts, and that is the point
 *
 * `DELETE /roles/:id` is refused with a 409 while any member holds the role,
 * and the server's count is `countActiveMembersUsingRole`, which counts members
 * with `status: { $ne: "removed" }` (`member.actions.ts:84-87`). `GET /members`
 * filters on precisely the same predicate (`member.actions.ts:21-24`). So a
 * count derived from the members list matches the server's count by
 * construction — including invited members, who **do** block a delete even
 * though they have never signed in.
 *
 * Deriving it rather than approximating it is what lets the roles screen say
 * "3 members hold this role" next to a Delete control and have the two agree.
 *
 * ## The one case where the count is 0 and the delete still fails
 *
 * There is none, in this direction. The reverse gap exists instead: a role held
 * **only by removed members** counts 0 here and deletes successfully, leaving
 * those rows pointing at a role that no longer exists. That is invisible on
 * this screen (removed rows are not listed) and self-heals if the person is
 * ever re-invited, because a re-invite always writes a fresh `roleId`
 * (`docs/contracts/team.md` §8f — reasoned from source, unverified by any test).
 *
 * ## Preset roles
 *
 * Presets are shared documents with `organizationId: null`, but the count is
 * over **this business's** members only, so "2" against Seller means two people
 * here — never a platform-wide total. `GET /members` is tenant-scoped by
 * `requireMember`, which is what makes that true without any filtering here.
 */

export interface RoleMemberCounts {
  /** Members holding `roleId`, counted as the delete guard counts them. */
  countFor: (roleId: ObjectId) => number;
  /** True until the directory has arrived — show nothing rather than a wrong 0. */
  isLoading: boolean;
  /**
   * The directory could not be fetched. `countFor` answers 0, so a caller must
   * check this before rendering a count or gating a control on one: 0 here
   * means "unknown", not "empty".
   */
  isError: boolean;
}

export function useRoleMemberCounts(): RoleMemberCounts {
  const directory = useMemberDirectory();

  const counts = new Map<ObjectId, number>();
  for (const member of directory.data ?? []) {
    // `role` is a populated reference on a list row and there is no `roleId`
    // field to fall back on — the mutation shapes have `roleId`, the list shape
    // does not. `null` is near-unreachable (a role in use cannot be deleted)
    // but the mapper guards for it, so this does too.
    const roleId = member.role?.id;
    if (!roleId) continue;
    counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
  }

  return {
    countFor: (roleId) => counts.get(roleId) ?? 0,
    isLoading: directory.isPending,
    isError: directory.isError,
  };
}
