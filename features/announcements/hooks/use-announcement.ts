"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { announcementKeys } from "../keys";
import * as announcementService from "../services/announcement.service";
import type { Announcement } from "../types";

/**
 * One announcement, for the reading screen.
 *
 * The response is complete on its own — `author: { id, name }` is populated by
 * the same mapper the list uses (contract §2.4) — so this screen names its
 * author without a second request. That is unusual in this API and it is the
 * reason a reading view here costs exactly one call, where the equivalent
 * project screen would need two.
 *
 * `id` is optional so the hook can be called before a route param has resolved.
 * `enabled` keeps it from firing with an empty id, which would cache a 404
 * under a key nothing will ever invalidate.
 *
 * No `retry` override: `lib/query/client.ts` already refuses to retry anything
 * under status 500, and a 404 for a deleted announcement is an answer rather
 * than a blip — this feature hard-deletes, so a link shared in a chat can
 * genuinely point at nothing. Restating the policy here is how one of the two
 * copies silently stops being true.
 */
export function useAnnouncement(
  id: ObjectId | undefined,
): UseQueryResult<Announcement, ApiError> {
  return useQuery<Announcement, ApiError>({
    // Only reached when `enabled` is true, so nothing is ever fetched under the
    // empty-string fallback.
    queryKey: announcementKeys.detail(id ?? ""),
    queryFn: () => {
      // Narrowed, not cast. `id as ObjectId` compiles and lies; with `enabled`
      // above, reaching this line means a wiring mistake, which is a bug rather
      // than something to paper over.
      if (!id) throw new Error("Announcement id is missing");
      return announcementService.getById(id);
    },
    enabled: Boolean(id),
  });
}
