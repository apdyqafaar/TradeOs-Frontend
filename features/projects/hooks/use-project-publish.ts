"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { projectKeys } from "../keys";
import * as projectService from "../services/project.service";
import { forgetShareToken, rememberShareToken } from "../share-token-store";
import type { PublishResult, UnpublishResult } from "../types";

/**
 * The three share-link writes, kept apart from the rest of the slice because
 * they behave unlike anything else in this app.
 *
 * All three take **one permission, `projects:publish`** — there is no separate
 * unpublish or regenerate permission (`project.route.ts:118,127,136`), so a
 * member either has the whole share card or none of it.
 *
 * **None of them answers a `Project`.** `publish` and `regenerate-link` answer
 * `{ shareToken, isPublished, publishedAt }`; `unpublish` answers
 * `{ isPublished: false }` and nothing more. So none of them seeds
 * `projectKeys.detail(id)` — spreading a `PublishResult` over a cached project
 * would write a `shareToken` key onto a shape that has none and, for unpublish,
 * blank `publishedAt` to `undefined`. They invalidate instead, and the refetch
 * answers the real row.
 *
 * **The token is captured here, at the only moment it exists.** See
 * `share-token-store.ts` for why it is held in memory and not in storage.
 */

/**
 * `POST /projects/:id/publish` — `projects:publish`. 200.
 *
 * **Two outcomes, and a screen must handle both:**
 *
 *   - **First publish** — `shareToken` is 64 hex characters. This is the only
 *     time the API will ever say it. Captured into the store here so it
 *     survives a navigation, and rendered plainly with a copy control by the
 *     share card.
 *   - **Re-publish after an unpublish** — `shareToken` is **`null`**. The hash
 *     was reused, so the old link works again exactly as it did
 *     (`public-link.test.ts:114-139`), but the plain value was never stored and
 *     cannot be re-issued. If this tab still holds it from the original
 *     publish, the card keeps showing it — which is why a `null` must never be
 *     written into the store; it would destroy the only copy in existence.
 *
 * **409 `ALREADY_PUBLISHED`** on an already-published project. That is the only
 * conflict in the feature, and it is a real one to expect: two members on the
 * same project, or a double-click. The card treats it as "already done" rather
 * than as a failure and refetches, because the outcome the user asked for is
 * the state the server is in.
 */
export function usePublishProject(): UseMutationResult<
  PublishResult,
  ApiError,
  ObjectId
> {
  const queryClient = useQueryClient();

  return useMutation<PublishResult, ApiError, ObjectId>({
    mutationFn: projectService.publish,
    onSuccess: (result, id) => {
      // Only a real token. `null` means "the server reused a hash it cannot
      // reverse", not "there is no link" — writing it would erase whatever this
      // tab already holds.
      if (result.shareToken) rememberShareToken(id, result.shareToken);

      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) });
      // The grid draws a "Published" pill from `isPublished`.
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

/**
 * `POST /projects/:id/unpublish` — `projects:publish`. 200
 * `{ isPublished: false }`.
 *
 * **The link stops working instantly** — the public lookup filters on
 * `isPublished: true` in the same query, with no cache and no grace period
 * (`project.actions.ts:130-131`, proven `public-link.test.ts:126-130`). The
 * stored token is dropped for that reason: a Copy button that still handed out
 * the URL would be handing out a 404.
 *
 * It is also **reversible without cost**: publishing again restores the same
 * link, because the hash was never touched. The re-publish will answer
 * `shareToken: null`, so the URL will be un-showable afterwards even though it
 * works — which is the honest thing to warn about before unpublishing, and the
 * card does.
 *
 * Never conflicts. Unpublishing an unpublished project is a 200 no-op.
 */
export function useUnpublishProject(): UseMutationResult<
  UnpublishResult,
  ApiError,
  ObjectId
> {
  const queryClient = useQueryClient();

  return useMutation<UnpublishResult, ApiError, ObjectId>({
    mutationFn: projectService.unpublish,
    onSuccess: (_result, id) => {
      forgetShareToken(id);

      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

/**
 * `POST /projects/:id/regenerate-link` — `projects:publish`. 200, and
 * `shareToken` is **always** a string.
 *
 * **It kills every link already given to a client**, immediately, by
 * overwriting the hash (`project.service.ts:362-364`, proven
 * `public-link.test.ts:141-166`). It is the only way to recover a lost token
 * and that is exactly what it costs — so it belongs behind a confirmation that
 * says so, not behind a plain button.
 *
 * It also **publishes a never-published project as a side effect**
 * (`project.service.ts:376-380`) and never conflicts, so it is safe to call in
 * any state — which is what makes it usable as the recovery path.
 */
export function useRegenerateShareLink(): UseMutationResult<
  PublishResult,
  ApiError,
  ObjectId
> {
  const queryClient = useQueryClient();

  return useMutation<PublishResult, ApiError, ObjectId>({
    mutationFn: projectService.regenerateLink,
    onSuccess: (result, id) => {
      // Always a string on this route, but guarded anyway: the alternative to
      // this `if` is writing `undefined` into the store on a shape surprise and
      // rendering `/p/undefined` as a link.
      if (result.shareToken) rememberShareToken(id, result.shareToken);
      else forgetShareToken(id);

      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}
