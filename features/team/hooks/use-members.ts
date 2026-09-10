"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { Paginated } from "@/lib/api/types";
import { memberKeys } from "../keys";
import * as memberService from "../services/member.service";
import type { ListedMember, MemberListParams } from "../types";

/**
 * The members list — active and invited, oldest first.
 *
 * `"use client"` even though this is not a component: it turns an accidental
 * import from a Server Component into a clear build error rather than a stack
 * trace inside React Query.
 *
 * Nothing here surfaces an error. A failure belongs to the component that
 * caused it — the inline card with the request id (brief §8.4) — and a toast
 * from `onError` would swallow it before the screen heard about it.
 *
 * **This is never "everyone who has ever been on the team".** Removed members
 * are filtered out server-side with no override, and `meta.total` excludes them
 * too. See `use-member-names.ts` for what that costs the id lookup.
 */
export function useMembers(
  params: MemberListParams = {},
): UseQueryResult<Paginated<ListedMember>, ApiError> {
  return useQuery<Paginated<ListedMember>, ApiError>({
    queryKey: memberKeys.list(params),
    queryFn: () => memberService.list(params),
    // Page is part of the key, so every page turn is a different query — without
    // this the table would unmount its rows and flash a skeleton on each one.
    // `keepPreviousData` holds the previous page on screen and reports the gap
    // through `isPlaceholderData`, which the table dims on rather than blanking.
    placeholderData: keepPreviousData,
  });
}

/**
 * The maximum `limit` the API accepts: `member.validation.ts:49-54` caps it at
 * 100 and answers 422 for 101, never a clamped default.
 */
export const MAX_MEMBER_LIMIT = 100;
