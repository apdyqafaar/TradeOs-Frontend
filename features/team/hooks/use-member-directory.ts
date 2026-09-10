"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import { memberKeys } from "../keys";
import * as memberService from "../services/member.service";
import type { ListedMember } from "../types";

/**
 * Every non-removed member of the business, all pages walked into one array.
 *
 * Two very different consumers need exactly this and nothing more, so they
 * share one query rather than each paging the list themselves:
 *
 *   - `useMemberNames` — id to display name, for the four screens that render a
 *     bare Member id (`soldBy`, `voidedBy`, `createdBy`, `receivedBy`).
 *   - `useRoleMemberCounts` — how many people hold each role, which the roles
 *     screen shows and which decides whether Delete can succeed at all.
 *
 * Sharing matters beyond the saved request: the count that gates the delete
 * button and the names in the members table are then derived from the same
 * snapshot, so they cannot disagree about who is on the team.
 *
 * This is **not** the hook a paginated table should use. `useMembers` is, and
 * it keeps its own per-page keys with `keepPreviousData`; this one deliberately
 * fetches everything and holds it for half an hour.
 */

/**
 * The API's ceiling on `limit` (`member.validation.ts:49-54`). Sending 101 is a
 * 422, never a clamp, so this is a hard number rather than a preference.
 */
const PAGE_SIZE = 100;

/**
 * A rail on the page walk. 20 pages is 2,000 members — far past any plausible
 * business on this product — and it exists so a server that miscomputed
 * `totalPages` cannot spin this into an unbounded request loop.
 */
const MAX_PAGES = 20;

/**
 * Walk `GET /members` to the end.
 *
 * Bounded by `meta.totalPages`, which the server computes from the same filter
 * as the rows (`responses.ts:60`), so it cannot disagree with what came back.
 * Most businesses answer in one request; a 250-person team costs three, once
 * per session.
 */
export const fetchMemberDirectory = async (): Promise<ListedMember[]> => {
  const everyone: ListedMember[] = [];

  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const { items, meta } = await memberService.list({
      page,
      limit: PAGE_SIZE,
    });

    everyone.push(...items);
    totalPages = meta.totalPages;
    page += 1;
  }

  return everyone;
};

/**
 * The shared directory query.
 *
 * Half an hour of `staleTime` because the answer only changes when somebody
 * joins or leaves, and both invalidate this key through `memberKeys.lists()`
 * (see `keys.ts`) — a long stale time never hides a change this app made.
 *
 * `retry: false`: the likely failure is a 403 from a custom role without
 * `members:view`, which will not become a 200 on the third attempt, and both
 * consumers degrade gracefully rather than erroring their screens.
 */
export function useMemberDirectory(): UseQueryResult<ListedMember[], ApiError> {
  return useQuery<ListedMember[], ApiError>({
    queryKey: memberKeys.directory(),
    queryFn: fetchMemberDirectory,
    staleTime: 30 * 60_000,
    retry: false,
  });
}
