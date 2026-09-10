"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { projectKeys } from "../keys";
import * as projectService from "../services/project.service";
import type { Project } from "../types";

/**
 * One project, for the detail screen.
 *
 * **The response is not complete on its own**, and that is the opposite of the
 * announcement equivalent: `customerId` and `createdBy` are bare ids with no
 * names attached (contract §1.5), so anything that wants to say *who* or *for
 * whom* costs another request. The detail screen resolves the customer through
 * `useCustomer` and does not resolve the member at all — see
 * `project-detail.tsx`.
 *
 * **It also carries no share token.** `isPublished` and `publishedAt` are the
 * whole of what a read tells you about the link (`project.actions.ts:21-26`,
 * proven `projects.test.ts:98-111`).
 *
 * `id` is optional so the hook can be called before a route param has resolved.
 * `enabled` keeps it from firing with an empty id, which would cache a 404
 * under a key nothing will ever invalidate.
 *
 * No `retry` override: `lib/query/client.ts` already refuses to retry anything
 * under status 500, and a 404 for a deleted project is an answer rather than a
 * blip — this feature hard-deletes, so a link shared in a chat can genuinely
 * point at nothing. Restating the policy here is how one of the two copies
 * silently stops being true.
 */
export function useProject(
  id: ObjectId | undefined,
): UseQueryResult<Project, ApiError> {
  return useQuery<Project, ApiError>({
    // Only reached when `enabled` is true, so nothing is ever fetched under the
    // empty-string fallback.
    queryKey: projectKeys.detail(id ?? ""),
    queryFn: () => {
      // Narrowed, not cast. `id as ObjectId` compiles and lies; with `enabled`
      // above, reaching this line means a wiring mistake, which is a bug rather
      // than something to paper over.
      if (!id) throw new Error("Project id is missing");
      return projectService.getById(id);
    },
    enabled: Boolean(id),
  });
}
