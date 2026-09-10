"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";
import { importKeys } from "../keys";
import * as importService from "../services/import.service";
import type { ImportJobListParams, ImportJobSummary } from "../types";

/**
 * The organization's import jobs, newest first.
 *
 * `"use client"` is here even though this is not a component: it turns an
 * accidental import from a Server Component into a clear build error instead of
 * a stack trace inside React Query.
 *
 * Nothing here shows an error. A failure belongs to the component that caused
 * it — the inline error card with the request id (brief §8.4) — and a toast
 * fired from `onError` would swallow it before the screen ever heard about it.
 *
 * ### What this list can and cannot show
 *
 * Rows are stripped at the database layer, so each item is an
 * `ImportJobSummary` with **no `rows` key at all**. It carries `status`,
 * `counts`, `filename`, `totalRows` and `expiresAt`, which is enough for a
 * "resume this import" row — but not enough to answer whether a job can be
 * committed, because that needs per-row `conflict.resolution` (see
 * `commitReadiness`). Do not put a Commit button on a list row.
 *
 * It also **cannot** show who uploaded the file: `createdBy` is stored on the
 * model and the shaper never maps it, so there is no member id to join on.
 *
 * And there is no server-side filter here — `?status=` on this endpoint is a
 * 422, not an ignored key. A "cancelled only" tab has to filter the page it
 * fetched, and must not claim to filter the list, because `meta.total` still
 * counts every job.
 *
 * A cancelled job stays in this list until it expires; it is a soft cancel, and
 * nothing in the backend deletes an import job.
 */
export function useImportJobs(
  params: ImportJobListParams = {},
): UseQueryResult<Paginated<ImportJobSummary>, ApiError> {
  return useQuery<Paginated<ImportJobSummary>, ApiError>({
    queryKey: importKeys.list(params),
    queryFn: () => importService.listJobs(params),
    // Page is part of the key, so every page turn is a different query —
    // without this the table would unmount its rows and flash a skeleton on
    // each one. `keepPreviousData` holds the previous rows on screen while the
    // next answer loads and reports the gap through `isPlaceholderData`, which
    // the table dims on rather than blanking.
    placeholderData: keepPreviousData,
  });
}
