"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { uploadKeys } from "@/features/uploads/keys";
import { listUploads } from "@/features/uploads/services/upload.service";
import type {
  ListUploadsParams,
  UploadGalleryItem,
} from "@/features/uploads/types";
import type { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";

export type { UploadGalleryItem } from "@/features/uploads/types";

/**
 * One page of the organization's image gallery.
 *
 * `GET /uploads` is gated on **`uploads:create`** — there is no view
 * permission — so a Seller does not get a read-only gallery here, they get a
 * 403. Callers should sit inside a `PermissionGate` for `uploads:create`; the
 * 403 is still handled where the data is rendered, because a gate hidden
 * behind a stale session is not a guarantee.
 *
 * **This never 503s.** `STORAGE_NOT_CONFIGURED` comes from `POST /uploads`
 * only: listing reads Mongo and never asks for storage, so a dev machine with
 * no S3 keys gets an ordinary (usually empty) list here and the 503 on the
 * first upload attempt. The plan's Task 4 test asserts the calm empty state
 * off *this* hook's error, so `<ImagePicker>` renders that state for the code
 * wherever it arrives from — see `docs/findings/s2-task-04.md`.
 *
 * No `staleTime` override: the 30 s default is right for a list this slice
 * invalidates itself on every upload and delete.
 */
export function useUploads(
  params: ListUploadsParams = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<Paginated<UploadGalleryItem>, ApiError> {
  return useQuery<Paginated<UploadGalleryItem>, ApiError>({
    queryKey: uploadKeys.list(params),
    queryFn: () => listUploads(params),
    enabled: options.enabled ?? true,
  });
}
