"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";
import { projectKeys } from "../keys";
import * as projectService from "../services/project.service";
import type { Project, ProjectListParams } from "../types";

/**
 * The projects grid, one page at a time.
 *
 * `"use client"` is here even though this is not a component: it turns an
 * accidental import from a Server Component into a clear build error instead of
 * a stack trace inside React Query.
 *
 * Nothing here shows an error. A failure belongs to the component that caused
 * it — the inline error card with the request id (brief §8.4) — and a toast
 * fired from `onError` would swallow it before the screen ever heard about it.
 *
 * **The filter surface is `status` and `customerId` and nothing else**, plus
 * pagination (contract §1.1). There is no search: `?search=x` is a 422
 * `Unrecognized key`, not an ignored one, so a search box here would break the
 * list rather than narrow it. Sort is fixed at newest-first.
 */
export function useProjects(
  params: ProjectListParams = {},
): UseQueryResult<Paginated<Project>, ApiError> {
  return useQuery<Paginated<Project>, ApiError>({
    queryKey: projectKeys.list(params),
    queryFn: () => projectService.list(params),
    // Page and status are part of the key, so every filter change is a
    // different query — without this the grid would unmount its cards and flash
    // a skeleton on each one. `keepPreviousData` holds the previous page on
    // screen while the next answer loads and reports the gap through
    // `isPlaceholderData`, which the grid dims on rather than blanking.
    placeholderData: keepPreviousData,
  });
}
