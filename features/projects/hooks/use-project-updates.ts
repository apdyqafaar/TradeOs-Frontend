"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId, Paginated } from "@/lib/api/types";
import { projectKeys } from "../keys";
import * as projectService from "../services/project.service";
import type { ProjectUpdate, ProjectUpdateListParams } from "../types";

/**
 * A project's progress notes, newest first, paginated.
 *
 * Its own query rather than a field on the project, because the API keeps them
 * apart: `GET /projects/:id/updates` is a separate paginated route, and the
 * project body carries no updates at all.
 *
 * **An unknown project id answers 404, not an empty list**
 * (`project.service.ts:246-247`), so an error here means the project is gone —
 * which is the same thing `useProject` will be reporting a moment later.
 *
 * The public page shows the newest **100** of these with no pagination
 * (`MAX_PUBLIC_UPDATES`), which is worth knowing when deciding how many to show
 * a member: they are looking at a window onto the same list their client sees.
 */
export function useProjectUpdates(
  projectId: ObjectId | undefined,
  params: ProjectUpdateListParams = {},
): UseQueryResult<Paginated<ProjectUpdate>, ApiError> {
  return useQuery<Paginated<ProjectUpdate>, ApiError>({
    queryKey: projectKeys.updateList(projectId ?? "", params),
    queryFn: () => {
      if (!projectId) throw new Error("Project id is missing");
      return projectService.listUpdates(projectId, params);
    },
    enabled: Boolean(projectId),
    // Paging the notes must not blank the panel the composer sits in.
    placeholderData: keepPreviousData,
  });
}
