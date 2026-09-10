"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authKeys } from "@/features/auth/keys";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { memberKeys, roleKeys } from "../keys";
import type { CreateRoleInput, UpdateRoleInput } from "../schemas/role.schema";
import * as roleService from "../services/role.service";
import type { Role } from "../types";

/**
 * The three role writes.
 *
 * All three invalidate `roleKeys.list()`, which is the whole list — there is
 * only one entry under that key, because `GET /roles` takes no parameters.
 *
 * Two of them reach further:
 *
 *   - **Update invalidates the session.** Editing a role edits the permissions
 *     of everyone holding it, possibly including the person doing the editing.
 *     The API rebuilds `req.permissions` from the role document on every
 *     request, so the change binds immediately server-side; the client's
 *     five-minute session cache would otherwise keep rendering controls the
 *     caller can no longer use. `GET /auth/me` returns the caller's role but
 *     not its id (`auth.controller.ts:94-107`), so there is no cheap way to ask
 *     "was that *my* role?" — invalidating unconditionally on a rare action is
 *     the smaller cost.
 *   - **Delete invalidates the members list.** It can only succeed when no
 *     non-removed member holds the role, so the list cannot contain a row
 *     pointing at it — but the roles screen derives its per-role member counts
 *     from that same list, and a stale count is what makes a "1 member still
 *     has it" 409 look like a bug.
 *
 * Create does neither: a brand-new role has no members by construction and
 * cannot be the caller's own.
 *
 * Nothing here shows an error. The refusals are all specific to their control —
 * a reserved name belongs on the name field, "1 member still has it" belongs in
 * the delete confirmation — so the components branch and render them.
 */

/** An update needs the role and the patch. */
export interface UpdateRoleVariables {
  roleId: ObjectId;
  input: UpdateRoleInput;
}

/**
 * `POST /roles` — 201 with the created role.
 *
 * `permissions` is required; the form always sends it, de-duplicated and in
 * catalog order (`permissionSet`).
 *
 * Two different 409 shapes to handle, and the second one has **no `code`**: a
 * reserved name is `code: "CONFLICT"`, a duplicate custom name arrives from the
 * unique index as `fieldErrors.name` with no code at all.
 */
export function useCreateRole(): UseMutationResult<
  Role,
  ApiError,
  CreateRoleInput
> {
  const queryClient = useQueryClient();

  return useMutation<Role, ApiError, CreateRoleInput>({
    mutationFn: roleService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roleKeys.list() });
    },
  });
}

/**
 * `PATCH /roles/:id` — 200 with the **full** merged role, so this response is
 * complete enough to seed the cache with rather than merely invalidate. The
 * list is invalidated as well, because a rename reorders it (custom roles sort
 * alphabetically).
 *
 * 403 for any preset; 404 for unknown or another tenant's, never 403.
 */
export function useUpdateRole(): UseMutationResult<
  Role,
  ApiError,
  UpdateRoleVariables
> {
  const queryClient = useQueryClient();

  return useMutation<Role, ApiError, UpdateRoleVariables>({
    mutationFn: ({ roleId, input }) => roleService.update(roleId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roleKeys.list() });
      queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}

/**
 * `DELETE /roles/:id` — 200 with **no `data`**, hence a `void` mutation.
 *
 * Refused with 409 while any non-removed member still holds the role, and the
 * message names the count. There is no cascade and no "move to default": the UI
 * has to move those members first, which is what the dialog says.
 */
export function useDeleteRole(): UseMutationResult<void, ApiError, ObjectId> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, ObjectId>({
    mutationFn: roleService.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roleKeys.list() });
      queryClient.invalidateQueries({ queryKey: memberKeys.lists() });
    },
  });
}
