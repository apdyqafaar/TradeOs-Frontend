"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";
import { announcementKeys } from "../keys";
import * as announcementService from "../services/announcement.service";
import type { Announcement, AnnouncementListParams } from "../types";

/**
 * The announcements feed, one page at a time.
 *
 * `"use client"` is here even though this is not a component: it turns an
 * accidental import from a Server Component into a clear build error instead of
 * a stack trace inside React Query.
 *
 * Nothing here shows an error. A failure belongs to the component that caused
 * it — the inline error card with the request id (brief §8.4) — and a toast
 * fired from `onError` would swallow it before the screen ever heard about it.
 *
 * **Calling this with no params really is "the newest announcements".** Unlike
 * `useDebts`, whose unfiltered call is secretly the open-debts worklist, there
 * is nothing for the server to default beyond `page: 1, limit: 20` — the query
 * schema has exactly two keys (contract §2.1).
 */
export function useAnnouncements(
  params: AnnouncementListParams = {},
): UseQueryResult<Paginated<Announcement>, ApiError> {
  return useQuery<Paginated<Announcement>, ApiError>({
    queryKey: announcementKeys.list(params),
    queryFn: () => announcementService.list(params),
    // Page is part of the key, so every page turn is a different query —
    // without this the feed would unmount its cards and flash a skeleton on
    // each one. `keepPreviousData` holds the previous page on screen while the
    // next answer loads and reports the gap through `isPlaceholderData`, which
    // the list dims on rather than blanking.
    placeholderData: keepPreviousData,
  });
}
