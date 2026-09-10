"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { uploadKeys } from "@/features/uploads/keys";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { projectKeys } from "../keys";
import type {
  CreateProjectInput,
  CreateProjectUpdateInput,
  UpdateProjectInput,
} from "../schemas/project.schema";
import * as projectService from "../services/project.service";
import type { Project, ProjectUpdate } from "../types";

/**
 * The five non-publishing writes in this slice, and the cache work each one
 * owes. (Publish, unpublish and regenerate live in `use-project-publish.ts` —
 * they answer a different shape and carry a secret, which is enough reason to
 * keep them apart.)
 *
 * **The one that surprises people is `useCreateProjectUpdate`.** Posting a
 * progress note is a write on a *sub-resource*, but when it carries `progress`
 * the API writes that value onto the **project row** in the same transaction
 * (`project.service.ts:291-294`, proven `projects.test.ts:135-163`). So it
 * invalidates the project detail and every list as well as the notes — a grid
 * left open in another tab is showing a stale progress bar until it does.
 *
 * **Detail entries are seeded, lists are invalidated.** Create and patch both
 * answer the whole `Project` from the same mapper `GET /projects/:id` uses
 * (`project.actions.ts:27-44`), so writing one into `projectKeys.detail(id)`
 * invents nothing and lets the detail screen update on the same frame. Lists
 * cannot be patched: a create moves `meta.total` and joins the head of page 1,
 * and a status change moves a row between filtered lists.
 *
 * **`uploadKeys.lists()` is invalidated by every write that can touch a cover**,
 * and this is the cross-feature edge that is easy to miss. Attaching a cover
 * moves an upload out of the *unattached* gallery `<ImagePicker>` shows;
 * clearing or replacing one **deletes the old image from storage and its row
 * from the database** (`attachments.service.ts:90-98`, proven by
 * `attach.test.ts:268-302`); and deleting a project releases its cover the same
 * way.
 *
 * None of these is optimistic. Create and patch can each be refused by a rule
 * only the server can evaluate — an unknown customer, a cover id that is
 * unknown, wrong-purpose or already attached — and the attach runs inside the
 * write's own transaction, so a refusal means *nothing* happened. A project
 * that appeared and then vanished is worse than a spinner.
 *
 * Nothing here renders an error. A refusal belongs at the control that caused
 * it (brief §8.4) — the cover 409s at the image picker, the customer 404 at the
 * customer field, the 403 at the form.
 */

/** The arguments an edit needs. The hook takes none, so the id rides along. */
export interface UpdateProjectVariables {
  id: ObjectId;
  input: UpdateProjectInput;
}

/** Posting a note. The project id is not in the body, it is in the path. */
export interface CreateProjectUpdateVariables {
  projectId: ObjectId;
  input: CreateProjectUpdateInput;
}

/** Deleting a note needs both ids: the delete is scoped by project as well. */
export interface DeleteProjectUpdateVariables {
  projectId: ObjectId;
  updateId: ObjectId;
}

/**
 * `POST /projects` — `projects:create`. 201 with the created row.
 *
 * The mutation's data is the created `Project`, so a caller's
 * `mutate(input, { onSuccess: (p) => … })` can navigate straight to it.
 *
 * Refusals a form must handle: **404 `NOT_FOUND` `"Customer not found"`** at
 * the customer field (a 404 on a create — see the service note), and the three
 * cover refusals at the image control (404 `"Upload not found"`, 409
 * `UPLOAD_PURPOSE_MISMATCH` — the purpose must be `"project"` — and 409
 * `UPLOAD_ATTACHED`).
 */
export function useCreateProject(): UseMutationResult<
  Project,
  ApiError,
  CreateProjectInput
> {
  const queryClient = useQueryClient();

  return useMutation<Project, ApiError, CreateProjectInput>({
    mutationFn: projectService.create,
    onSuccess: (project) => {
      queryClient.setQueryData<Project>(
        projectKeys.detail(project.id),
        project,
      );

      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      // A cover, if there was one, has just left the unattached gallery.
      void queryClient.invalidateQueries({ queryKey: uploadKeys.lists() });
    },
  });
}

/**
 * `PATCH /projects/:id` — `projects:update`. 200 with the updated row.
 *
 * The caller must build its body with `projectPatch`, which sends only changed
 * fields and returns `null` when nothing changed. **`PATCH {}` is a 422**, and
 * its message arrives under the field key `"_"` rather than under anything a
 * form has a control for.
 *
 * This route cannot publish or unpublish: `isPublished` is `.strict()`-rejected
 * on the body. Nor can it clear a description, a customer or either date —
 * `null` is a 422 on all four (contract §1.3).
 */
export function useUpdateProject(): UseMutationResult<
  Project,
  ApiError,
  UpdateProjectVariables
> {
  const queryClient = useQueryClient();

  return useMutation<Project, ApiError, UpdateProjectVariables>({
    mutationFn: ({ id, input }) => projectService.update(id, input),
    onSuccess: (project) => {
      queryClient.setQueryData<Project>(
        projectKeys.detail(project.id),
        project,
      );

      // Not only because the title changed: `status` decides which filtered
      // lists this row belongs to, and `progress` is drawn on every card.
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      // A replaced cover deletes the old upload's row outright; a cleared one
      // deletes the current image. Either way the gallery is stale.
      void queryClient.invalidateQueries({ queryKey: uploadKeys.lists() });
    },
  });
}

/**
 * `DELETE /projects/:id` — `projects:delete`. **204, empty.**
 *
 * Irreversible, and it **cascades**: every progress note goes with the project
 * in the same transaction (`project.service.ts:215-239`, proven
 * `projects.test.ts:195-215`), and the cover image is released from storage
 * afterwards. Put it behind a confirmation.
 *
 * The response carries nothing, so the id is taken from the variables.
 * `removeQueries` rather than `invalidateQueries` on the detail entry and the
 * notes: invalidating would refetch an id the server has just stopped serving
 * and cache a 404 under it.
 */
export function useDeleteProject(): UseMutationResult<
  void,
  ApiError,
  ObjectId
> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, ObjectId>({
    mutationFn: projectService.remove,
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: projectKeys.detail(id) });
      // The cascade, mirrored in the cache: the notes are gone server-side, so
      // leaving them cached would let a back-navigation render a panel of rows
      // that no longer exist.
      queryClient.removeQueries({ queryKey: projectKeys.updates(id) });

      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      // The cover went with it.
      void queryClient.invalidateQueries({ queryKey: uploadKeys.lists() });
    },
  });
}

/**
 * `POST /projects/:id/updates` — **`projects:update`**. 201 with the note.
 *
 * **This is the write that moves the project.** A note carrying `progress`
 * writes that value onto the project row in the same transaction, so all three
 * caches are invalidated and not just the notes list. A note *without*
 * `progress` leaves the project alone and comes back with `progress: null` —
 * the invalidation is unconditional anyway, because distinguishing them here
 * would put the same rule in two places and one of them would rot.
 *
 * No cover, so no `uploadKeys` work: a note is text and a number.
 */
export function useCreateProjectUpdate(): UseMutationResult<
  ProjectUpdate,
  ApiError,
  CreateProjectUpdateVariables
> {
  const queryClient = useQueryClient();

  return useMutation<ProjectUpdate, ApiError, CreateProjectUpdateVariables>({
    mutationFn: ({ projectId, input }) =>
      projectService.createUpdate(projectId, input),
    onSuccess: (_update, { projectId }) => {
      void queryClient.invalidateQueries({
        queryKey: projectKeys.updates(projectId),
      });
      // The project's own `progress` may have just changed under us.
      void queryClient.invalidateQueries({
        queryKey: projectKeys.detail(projectId),
      });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

/**
 * `DELETE /projects/:id/updates/:updateId` — **`projects:update`**, not
 * `projects:delete`. **204, empty.**
 *
 * **The project's progress is NOT rolled back.** Nothing recomputes it
 * (`project.service.ts:305-315` has no progress logic), so a note that set
 * progress to 40 leaves the project at 40 after it is deleted. The project
 * detail is invalidated anyway — not to undo anything, but because a member who
 * has just deleted a note should be looking at whatever the server actually
 * holds rather than at a number this client reasoned its way to.
 *
 * It disappears from the public page immediately too, since that read is a live
 * query.
 */
export function useDeleteProjectUpdate(): UseMutationResult<
  void,
  ApiError,
  DeleteProjectUpdateVariables
> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, DeleteProjectUpdateVariables>({
    mutationFn: ({ projectId, updateId }) =>
      projectService.removeUpdate(projectId, updateId),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({
        queryKey: projectKeys.updates(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: projectKeys.detail(projectId),
      });
    },
  });
}
