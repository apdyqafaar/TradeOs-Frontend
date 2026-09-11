"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { memberKeys } from "@/features/team/keys";
import * as memberService from "@/features/team/services/member.service";
import type { ListedMember } from "@/features/team/types";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";

/**
 * One member, for the detail screen.
 *
 * Reads `GET /members/:id` rather than picking the row out of a cached list:
 * the list is paginated, so a member opened from a link — or from a row on
 * page three after a reload — is usually not in the cache at all, and a hook
 * that quietly returns `undefined` in that case is a blank screen with no
 * error.
 *
 * A 404 here means the id is unknown **or the member was removed**, which are
 * the same thing to this product — removed members are excluded from the list
 * permanently and there is no former-staff view. The screen says so rather
 * than showing an error card.
 */
export function useMember(
  id: ObjectId,
): UseQueryResult<ListedMember, ApiError> {
  return useQuery<ListedMember, ApiError>({
    queryKey: memberKeys.detail(id),
    queryFn: () => memberService.get(id),
  });
}
