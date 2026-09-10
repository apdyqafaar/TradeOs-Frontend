"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import { roleKeys } from "../keys";
import * as roleService from "../services/role.service";
import type { Role } from "../types";

/**
 * Every role this business can see: the three global presets plus its own
 * custom roles.
 *
 * **Not paginated, and there is no `meta`.** `useQuery<Role[]>`, not
 * `Paginated<Role>` — reusing the members list hook's shape here would be a
 * runtime `undefined` where `meta.total` was expected.
 *
 * `staleTime` is generous because roles change on a human timescale — somebody
 * defines "Stock clerk" once and then hires against it for a year — and this
 * query fills the assign dropdown on a screen whose other half refetches on
 * every mutation. `useRoleMutations` invalidates the key on each write, so a
 * long stale time never hides the caller's own edit.
 */
export interface UseRolesOptions {
  /**
   * Set `false` when the caller does not hold `roles:view`.
   *
   * The members screen is gated on `members:invite`, not `roles:view`, so a
   * custom role can legitimately stand there without this permission. Firing
   * the request anyway would spend a round trip on a guaranteed 403 and leave a
   * red herring in the network tab for whoever debugs that screen next.
   *
   * A disabled query reports `isPending: true` forever in React Query v5
   * (status "pending", fetchStatus "idle"), so a caller that renders a spinner
   * on `isPending` must check the same condition it passed in here.
   */
  enabled?: boolean;
}

export function useRoles({
  enabled = true,
}: UseRolesOptions = {}): UseQueryResult<Role[], ApiError> {
  return useQuery<Role[], ApiError>({
    queryKey: roleKeys.list(),
    queryFn: roleService.list,
    enabled,
    staleTime: 5 * 60_000,
  });
}
