"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { uploadKeys } from "@/features/uploads/keys";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { announcementKeys } from "../keys";
import type {
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from "../schemas/announcement.schema";
import * as announcementService from "../services/announcement.service";
import type { Announcement } from "../types";

/**
 * The three writes in this slice, and the cache work each one owes.
 *
 * **Every one of them invalidates `announcementKeys.lists()`, pinning
 * included**, and that is not laziness. The feed is sorted
 * `{ pinned: -1, createdAt: -1, _id: -1 }` *before* it is paginated
 * (`announcement.actions.ts:100`), so:
 *
 *   - a new announcement joins the head of page 1 and moves `meta.total`;
 *   - **pinning moves a row across pages** — it jumps to the head of page 1 and
 *     pushes the oldest row there onto page 2;
 *   - deleting removes a row and moves `meta.total`.
 *
 * No cached page can be patched to match any of those. A `setQueryData` that
 * flipped `pinned` in place would leave the card exactly where it was and
 * quietly disagree with the server about what page 2 contains — which is the
 * specific way a hand-patched cache lies on this screen.
 *
 * **Detail entries are seeded, lists are invalidated.** Create and patch both
 * answer the whole `Announcement` from the same mapper `GET /announcements/:id`
 * uses (`announcement.actions.ts:46-72`), so writing one into
 * `announcementKeys.detail(id)` invents nothing and lets the reading screen
 * update on the same frame.
 *
 * **`announcementKeys.unreadCount()` is invalidated by all three**, added
 * 2026-09-10 with read tracking. The badge in the sidebar and the feed must not
 * be able to disagree, and each write can move the count:
 *
 *   - **create** puts an unread notice in front of every other member;
 *   - **delete** removes one, which decrements the count for everybody who had
 *     not read it and leaves it alone for everybody who had — a distinction no
 *     client can compute, because it depends on other members' rows;
 *   - **update** is the only arguable one. Pinning plainly does not change what
 *     anyone has read. But this hook is also the edit, and whether the server
 *     treats an edited notice as newly unread is *its* rule to make, not
 *     something the client may assume. Invalidating asks; assuming is how a
 *     badge ends up permanently one out.
 *
 * The count is deliberately never adjusted arithmetically here. It is a
 * server-side fact about one member, and the same member may have the app open
 * on a second device.
 *
 * **`uploadKeys.lists()` is invalidated by all three**, and this is the
 * cross-feature edge that is easy to miss. Attaching a cover moves an upload out
 * of the *unattached* gallery `<ImagePicker>` shows; clearing or replacing one
 * **deletes the old image from storage and its row from the database**
 * (`attachments.service.ts:90-98`, proven by `attach.test.ts:268-302`); and
 * deleting an announcement releases its cover the same way. The picker's own
 * pane would otherwise keep offering an image that no longer exists — and the
 * per-member pending-upload cap it helps you clear would be counted wrong.
 *
 * None of these is optimistic. Two of the three can be refused by a rule only
 * the server can evaluate — a cover id that is unknown, wrong-purpose or already
 * attached — and the attach runs inside the write's own transaction, so a
 * refusal means *nothing* happened. An announcement that appeared and then
 * vanished is worse than a spinner.
 *
 * Nothing here renders an error. A refusal belongs at the control that caused
 * it (brief §8.4) — the cover 409s at the image picker, the 403 at the form —
 * and a toast fired from `onError` here would consume it first.
 */

/** The arguments an edit needs. The hook takes none, so the id rides along. */
export interface UpdateAnnouncementVariables {
  id: ObjectId;
  input: UpdateAnnouncementInput;
}

/**
 * `POST /announcements` — `announcements:create`. 201 with the created row.
 *
 * The mutation's data is the created `Announcement`, so a caller's
 * `mutate(input, { onSuccess: (a) => … })` can navigate straight to it.
 *
 * Refusals a form must handle, all at the image control because all three come
 * from the cover: 404 `NOT_FOUND` (`"Upload not found"`), 409
 * `UPLOAD_PURPOSE_MISMATCH` (the upload's purpose must be `"announcement"`) and
 * 409 `UPLOAD_ATTACHED`. **There is no domain 409 on announcements themselves**
 * — no duplicate-title conflict, no publish state to clash with (contract §7).
 */
export function useCreateAnnouncement(): UseMutationResult<
  Announcement,
  ApiError,
  CreateAnnouncementInput
> {
  const queryClient = useQueryClient();

  return useMutation<Announcement, ApiError, CreateAnnouncementInput>({
    mutationFn: announcementService.create,
    onSuccess: (announcement) => {
      queryClient.setQueryData<Announcement>(
        announcementKeys.detail(announcement.id),
        announcement,
      );

      void queryClient.invalidateQueries({
        queryKey: announcementKeys.lists(),
      });
      // A notice nobody has read yet just appeared.
      void queryClient.invalidateQueries({
        queryKey: announcementKeys.unreadCount(),
      });
      // A cover, if there was one, has just left the unattached gallery.
      void queryClient.invalidateQueries({ queryKey: uploadKeys.lists() });
    },
  });
}

/**
 * `PATCH /announcements/:id` — `announcements:update`. 200 with the updated row.
 *
 * **This is also the pin and unpin button.** There is no `POST /pin` route;
 * pinning is `PATCH { pinned: true }` and unpinning is `PATCH { pinned: false }`
 * — one field, and `false` is a real value the body must carry, not an absence
 * to be filtered out (contract §2.3, trap 5).
 *
 * The caller must build its body with `announcementPatch`, which sends only
 * changed fields and returns `null` when nothing changed. **`PATCH {}` is a
 * 422**, and its message arrives under the field key `"_"` rather than under
 * anything a form has a control for.
 *
 * Editing is permission-based, not author-based, and does not reassign
 * `createdBy` or `author` — so a manager tidying somebody else's typo leaves
 * their name on it, which is what the reading screen keeps showing.
 */
export function useUpdateAnnouncement(): UseMutationResult<
  Announcement,
  ApiError,
  UpdateAnnouncementVariables
> {
  const queryClient = useQueryClient();

  return useMutation<Announcement, ApiError, UpdateAnnouncementVariables>({
    mutationFn: ({ id, input }) => announcementService.update(id, input),
    onSuccess: (announcement) => {
      queryClient.setQueryData<Announcement>(
        announcementKeys.detail(announcement.id),
        announcement,
      );

      // Not just because the title changed: `pinned` decides which page this
      // row lives on, and the sort runs before pagination.
      void queryClient.invalidateQueries({
        queryKey: announcementKeys.lists(),
      });
      // Asked rather than assumed: whether an edit makes a notice unread again
      // is the server's rule, and the badge must not guess it.
      void queryClient.invalidateQueries({
        queryKey: announcementKeys.unreadCount(),
      });
      // A replaced cover deletes the old upload's row outright; a cleared one
      // deletes the current image. Either way the gallery is stale.
      void queryClient.invalidateQueries({ queryKey: uploadKeys.lists() });
    },
  });
}

/**
 * `DELETE /announcements/:id` — `announcements:delete`. **204, empty.**
 *
 * Irreversible: a hard `findOneAndDelete` with no soft-delete flag and no
 * restore path (`announcement.actions.ts:126-131`), and the cover image is
 * released from storage after the transaction commits. Put it behind a
 * confirmation.
 *
 * The response carries nothing, so the id is taken from the variables — this is
 * the one mutation in the slice whose `onSuccess` cannot read the row it
 * touched. `removeQueries` rather than `invalidateQueries` on the detail entry:
 * invalidating would refetch an id the server has just stopped serving and cache
 * a 404 under it. Removing is also what lets the reading screen distinguish
 * "you deleted this" from "this 404s", because it navigates away first.
 */
export function useDeleteAnnouncement(): UseMutationResult<
  void,
  ApiError,
  ObjectId
> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, ObjectId>({
    mutationFn: announcementService.remove,
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: announcementKeys.detail(id) });

      void queryClient.invalidateQueries({
        queryKey: announcementKeys.lists(),
      });
      // An unread notice that no longer exists is one fewer unread notice —
      // for everybody who had not opened it, which is not a fact this client
      // holds.
      void queryClient.invalidateQueries({
        queryKey: announcementKeys.unreadCount(),
      });
      // The cover went with it.
      void queryClient.invalidateQueries({ queryKey: uploadKeys.lists() });
    },
  });
}
