"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { uploadKeys } from "@/features/uploads/keys";
import {
  createUpload,
  deleteUpload,
} from "@/features/uploads/services/upload.service";
import type { CreateUploadInput, Upload } from "@/features/uploads/types";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";

/**
 * Both writes invalidate `uploadKeys.lists()` and nothing else.
 *
 * `lists()` is a function here while `createQueryKeys` exposes `lists` as an
 * array — see the comment in `../keys.ts` for why this slice wraps it.
 *
 * An upload changes what the gallery holds *and* how many unattached images
 * the member is holding, and both of those are answered by the same list, so
 * one invalidation covers it. Nothing reaches into `features/products` from
 * here: a product's images are denormalised onto the product by the API when
 * it attaches them, so it is the product mutation's job to refresh the
 * product — not this one's.
 */
const useInvalidateUploadLists = () => {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: uploadKeys.lists() });
  };
};

/**
 * `POST /uploads` — multipart, one image at a time.
 *
 * Every failure worth its own words on screen, from the backend source rather
 * than from a guess:
 *
 * | code | status | what happened |
 * |---|---|---|
 * | `STORAGE_NOT_CONFIGURED` | 503 | No S3 keys. **The normal state on a dev machine** — `getStorage()` is null and the request is refused before the file is even decoded. |
 * | `UPLOAD_PENDING_LIMIT` | 409 | The member already holds five uploads nothing has attached. `details` carries `{ pending, max }`. |
 * | `UNSUPPORTED_IMAGE` | 422 | sharp decoded it and it was not JPEG, PNG or WebP — HEIC lands here. |
 * | `IMAGE_TOO_LARGE` | 422 | Over 50 megapixels. Nothing to do with the byte limit. |
 * | `FILE_TOO_LARGE` | 413 | Over 10 MB, refused by multer before the handler runs. |
 * | `VALIDATION_ERROR` | 422 | No `file` part, more than one file, or a wrong field name. |
 * | `STORAGE_ERROR` | 502 | S3 was reachable and the write failed. |
 *
 * A 429 is possible too — 100 uploads per 15 minutes per organization — and is
 * already handled centrally as a toast by `lib/api/client`.
 *
 * There is no `onError` here: the picker renders the refusal beside the tile
 * the person just tried to add, where the file they chose is still on screen.
 * A toast would separate the reason from the thing it is about.
 */
export function useCreateUpload(): UseMutationResult<
  Upload,
  ApiError,
  CreateUploadInput
> {
  const invalidate = useInvalidateUploadLists();

  return useMutation<Upload, ApiError, CreateUploadInput>({
    mutationFn: createUpload,
    onSuccess: invalidate,
  });
}

/**
 * `DELETE /uploads/:id`, taking the id as its mutation variable.
 *
 * The id is the variable rather than a hook argument for the same reason as
 * `useDeleteCategory`: one mutation instance serves a whole grid, and
 * `mutation.variables` is then the id of the tile that failed — which is how a
 * refusal lands on the right image instead of in a toast.
 *
 * Refused with 409 `UPLOAD_ATTACHED` while something still uses the image, and
 * 404 when it is already gone.
 */
export function useDeleteUpload(): UseMutationResult<void, ApiError, ObjectId> {
  const invalidate = useInvalidateUploadLists();

  return useMutation<void, ApiError, ObjectId>({
    mutationFn: deleteUpload,
    onSuccess: invalidate,
  });
}
