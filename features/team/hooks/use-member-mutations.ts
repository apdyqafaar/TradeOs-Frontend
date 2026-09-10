"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authKeys } from "@/features/auth/keys";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { memberKeys } from "../keys";
import type {
  ChangeMemberRoleInput,
  InviteMemberInput,
} from "../schemas/member.schema";
import * as memberService from "../services/member.service";
import type { PublicMember } from "../types";

/**
 * The four member writes, and the one cache rule they all obey.
 *
 * **Every one of them invalidates the list and none of them patches it.** That
 * is not caution, it is the shape of the API: the mutating endpoints answer
 * `publicMember`, which has **no `user` key at all**, a bare `roleId` string
 * instead of a `role` reference, and `role` on only two of the four. A list row
 * is `listedMember` — populated `user`, populated `role`, no `roleId`. Splicing
 * one into the other blanks the person's name and, on a resend or a remove,
 * loses their role too (`docs/contracts/team.md` T1).
 *
 * The four also each move the list in a way no patch could express anyway: an
 * invite appends a row at the end of an oldest-first sort and moves
 * `meta.total`; a removal takes a row off the list entirely, on whichever page
 * it happened to sit; a role change alters a populated reference the response
 * only half describes. Refetching is both the honest answer and the cheap one —
 * a members list is tens of rows, not thousands.
 *
 * Nothing here renders an error. Every refusal in this slice is specific to the
 * control that caused it — "You cannot remove yourself" belongs on the row's
 * menu, `EMAIL_NOT_VERIFIED` belongs in the invite dialog — so the components
 * branch on `code` and a toast fired from `onError` here would consume the
 * error first.
 */

/** A role change needs the member and the role. The hook takes no arguments. */
export interface ChangeMemberRoleVariables {
  memberId: ObjectId;
  input: ChangeMemberRoleInput;
}

/**
 * `POST /members/invite` — 201.
 *
 * Refusals the dialog must speak for: 403 `EMAIL_NOT_VERIFIED` (the caller's
 * own inbox, not a permission), 403 for the Owner preset, 409 for a self-invite
 * or an address that already belongs somewhere, 429 with `Retry-After`.
 *
 * A success is not proof of delivery — a failed send still answers 201 — which
 * is why Resend is a first-class control on every pending row rather than
 * something hidden in an overflow menu.
 */
export function useInviteMember(): UseMutationResult<
  PublicMember,
  ApiError,
  InviteMemberInput
> {
  const queryClient = useQueryClient();

  return useMutation<PublicMember, ApiError, InviteMemberInput>({
    mutationFn: memberService.invite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.lists() });
    },
  });
}

/**
 * `POST /members/:id/resend-invite` — 200.
 *
 * Invalidates the list even though the row's rendered fields do not change: the
 * old token is dead and a new 7-day one is issued, and the row is the only
 * place a stale view of "there is an outstanding invitation" could live. The
 * refetch costs one request and removes a class of confusion entirely.
 *
 * **The expiry itself is not renderable.** The 7-day TTL lives on a
 * `Verification` document the API never returns, and no member field carries
 * it (`docs/contracts/team.md` T2).
 */
export function useResendInvite(): UseMutationResult<
  PublicMember,
  ApiError,
  ObjectId
> {
  const queryClient = useQueryClient();

  return useMutation<PublicMember, ApiError, ObjectId>({
    mutationFn: memberService.resendInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.lists() });
    },
  });
}

/**
 * `PATCH /members/:id` — 200.
 *
 * Invalidates the members list, and **also the session** — because there is no
 * self-check on this endpoint. A manager holding `members:update` can re-role
 * themselves, permissions are rebuilt from the member row on every request, and
 * the change binds on their very next call. Without invalidating
 * `authKeys.session()` the shell would keep rendering the old permissions until
 * the five-minute session cache expired: nav items that 403 on click, and
 * controls that should have disappeared still on screen.
 *
 * Invalidating it unconditionally rather than comparing ids is deliberate — the
 * comparison is not free to make correctly. `GET /auth/me` does not return the
 * caller's own **member** id (`auth.controller.ts:94-107`), only `user`, so
 * "did I just re-role myself?" has to be answered by matching `user.id` against
 * the row, which the mutation variables do not carry. One extra `/auth/me` on a
 * rare action beats a stale permission set.
 */
export function useChangeMemberRole(): UseMutationResult<
  PublicMember,
  ApiError,
  ChangeMemberRoleVariables
> {
  const queryClient = useQueryClient();

  return useMutation<PublicMember, ApiError, ChangeMemberRoleVariables>({
    mutationFn: ({ memberId, input }) =>
      memberService.changeRole(memberId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.lists() });
      queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}

/**
 * `DELETE /members/:id` — 200, and it **deactivates**: the row flips to
 * `status: "removed"`, keeps its `userId`, and every session that person holds
 * is revoked on the spot.
 *
 * The list refetch is what makes the row vanish, and it is the only correct
 * outcome to render: `GET /members` excludes removed rows, so there is no
 * "removed" state for the table to show. Cancelling a pending invitation is
 * this same call and behaves identically.
 *
 * The session is **not** invalidated here. Removing yourself is a 403 the
 * server refuses outright, so a successful removal never changes the caller's
 * own permissions — unlike a role change, which can.
 */
export function useRemoveMember(): UseMutationResult<
  PublicMember,
  ApiError,
  ObjectId
> {
  const queryClient = useQueryClient();

  return useMutation<PublicMember, ApiError, ObjectId>({
    mutationFn: memberService.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.lists() });
    },
  });
}
