"use client";

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useCan } from "@/features/auth/hooks/use-permission";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId, Paginated } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { announcementKeys } from "../keys";
import * as announcementService from "../services/announcement.service";
import type {
  Announcement,
  AnnouncementReadAllResult,
  AnnouncementReadReceipt,
  AnnouncementUnreadCount,
} from "../types";

/**
 * Read tracking, the whole of it — one query and two mutations.
 *
 * The shape of this feature is worth stating once, because it decides
 * everything below: **read state arrived as aggregates, not as a field.** A
 * count says how many notices the caller has not read; nothing says which. So
 * the badge is exact, the feed's per-row dot is drawn only when the rows
 * happen to carry `readAt`, and no code here ever derives one from the other.
 */

/**
 * How many notices this member has not read.
 *
 * **Gated on `announcements:view`, and the gate is `enabled`, not a `catch`.**
 * Every preset holds it — Owner by wildcard, Manager by `ALL_PERMISSIONS`,
 * Seller explicitly — so this should never be false for a real member, but a
 * hand-built custom role without it exists in `RouteGuard`'s world too
 * (`docs/FINDINGS.md` §3), and this hook is mounted in the **sidebar**: a 403
 * here would fire on every screen in the product rather than on the one page
 * that asked for it. `useCan` is also false while the session loads and false
 * when signed out, which is exactly when a nav badge must not be fetching.
 *
 * `select` projects `{ count }` down to the number. The service deliberately
 * returns the object (the wire shape belongs in one place); the badge wants an
 * integer, and doing the reach-in here means a component never sees the
 * envelope's grandchild.
 *
 * **A failure is silently `undefined`, and that is the design.** The badge
 * renders nothing without a count, so an unreachable API costs a missing dot
 * rather than an error card bolted to the sidebar of every screen. Nothing here
 * toasts, for the same reason.
 */
export function useUnreadAnnouncementCount(): UseQueryResult<number, ApiError> {
  const canView = useCan(PERMISSIONS.ANNOUNCEMENTS_VIEW);

  return useQuery<AnnouncementUnreadCount, ApiError, number>({
    queryKey: announcementKeys.unreadCount(),
    queryFn: announcementService.unreadCount,
    select: (data) => data.count,
    enabled: canView,
    // Longer than the 30 s global default: this is mounted for the whole
    // session in the sidebar, it is invalidated explicitly by every write that
    // can move it, and a badge that is a minute stale is not a bug — a badge
    // that costs a request every thirty seconds on a phone connection is.
    staleTime: 60_000,
  });
}

/**
 * Patch one row's `readAt` wherever it is cached, without touching anything
 * else.
 *
 * **This is the one write in the slice that may patch the cache in place**, and
 * the reason is precise: `readAt` takes no part in the sort. The feed is
 * ordered `{ pinned: -1, createdAt: -1, _id: -1 }` before pagination, which is
 * why `use-announcement-mutations.ts` refuses to hand-patch a pin — flipping
 * `pinned` in place leaves the card where it was and disagrees with the server
 * about what page 2 contains. Marking a notice read moves nothing. So the
 * alternative, invalidating every cached page each time somebody opens a
 * notice, would buy nothing and cost a full feed refetch per read on a
 * mobile-heavy market.
 */
function patchReadAt(
  pages: Paginated<Announcement> | undefined,
  id: ObjectId,
  readAt: string,
): Paginated<Announcement> | undefined {
  if (!pages) return pages;
  let touched = false;
  const items = pages.items.map((row) => {
    if (row.id !== id) return row;
    touched = true;
    return { ...row, readAt };
  });
  // Same object back when this page did not hold the row, so React Query does
  // not notify every other page's subscriber that its data changed.
  return touched ? { ...pages, items } : pages;
}

/**
 * `POST /announcements/:id/read`.
 *
 * Idempotent server-side, so a double-fire is harmless — but it still costs a
 * request, which is why `useMarkAnnouncementReadOnView` below fires it once per
 * announcement rather than once per render.
 *
 * Cache work, in the order it happens:
 *
 *   1. the detail entry gets the server's `readAt`, so the screen the reader is
 *      on stops being unread on the same frame;
 *   2. every cached feed page gets the same value patched into that one row;
 *   3. the unread count is **invalidated, not decremented**. Client-side
 *      arithmetic would be wrong the moment the same member has the app open on
 *      a second device, and it would be wrong in the direction that matters —
 *      a badge stuck at 1 that nothing can clear.
 */
export function useMarkAnnouncementRead(): UseMutationResult<
  AnnouncementReadReceipt,
  ApiError,
  ObjectId
> {
  const queryClient = useQueryClient();

  return useMutation<AnnouncementReadReceipt, ApiError, ObjectId>({
    mutationFn: announcementService.markRead,
    onSuccess: (receipt) => {
      queryClient.setQueryData<Announcement>(
        announcementKeys.detail(receipt.id),
        (current) =>
          current ? { ...current, readAt: receipt.readAt } : current,
      );

      queryClient.setQueriesData<Paginated<Announcement>>(
        { queryKey: announcementKeys.lists() },
        (pages) => patchReadAt(pages, receipt.id, receipt.readAt),
      );

      void queryClient.invalidateQueries({
        queryKey: announcementKeys.unreadCount(),
      });
    },
  });
}

/**
 * `POST /announcements/read-all`.
 *
 * Both the feed and the count are invalidated rather than patched, and here
 * that is the right way round: the response is `{ count }` — how many were
 * *newly* marked — and carries no per-row timestamps, so patching the cache
 * would mean stamping every visible row with a `readAt` this client invented.
 * `readAt` is currently only ever compared against `null`, so the invented
 * value would not show today; it would show the first time somebody renders it,
 * which is the kind of lie that ships green.
 *
 * Marking all read is a deliberate, rare click. One refetch is the correct
 * price for not making anything up.
 */
export function useMarkAllAnnouncementsRead(): UseMutationResult<
  AnnouncementReadAllResult,
  ApiError,
  void
> {
  const queryClient = useQueryClient();

  return useMutation<AnnouncementReadAllResult, ApiError, void>({
    mutationFn: () => announcementService.markAllRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: announcementKeys.lists(),
      });
      void queryClient.invalidateQueries({
        queryKey: announcementKeys.unreadCount(),
      });
    },
  });
}

/**
 * Opening the reading view marks the notice read.
 *
 * Takes the loaded `Announcement` rather than an id, because three of the four
 * guards need the row itself. It fires **at most one request per announcement**,
 * and each guard is here for a different failure:
 *
 *   - **`announcement` is undefined** while the query is in flight. Firing on
 *     the id alone would mark a notice read that turns out to be a 404, or a
 *     403 — a write on behalf of somebody who never saw anything.
 *   - **`canView` is false.** `announcements:view` gates this endpoint as well,
 *     so a caller who cannot read the notice must not be posting a receipt for
 *     it. False while the session loads, which is also correct: nothing should
 *     fire before we know who is asking.
 *   - **`readAt` is already set.** The endpoint is idempotent, so this is a
 *     saved request rather than a correctness fix — but it is the difference
 *     between one POST the first time a notice is opened and one POST every
 *     time anyone re-reads it.
 *   - **`markedRef` already holds this id.** The effect re-runs on every render
 *     that changes its inputs, and the mutation's own success handler changes
 *     one of them (`readAt` lands in the cached detail), so without this the
 *     first success re-triggers the effect. The ref is set *before* the request
 *     rather than in `onSuccess`, so an in-flight request is not fired twice by
 *     a re-render either; the id, rather than a boolean, is what lets one
 *     mounted screen move from notice to notice.
 *
 * A failure is deliberately not retried and not shown. The reader is reading;
 * a red panel because a read receipt did not save would be noise about
 * something they did not ask for, and the next visit marks it anyway.
 */
export function useMarkAnnouncementReadOnView(
  announcement: Announcement | undefined,
): void {
  const canView = useCan(PERMISSIONS.ANNOUNCEMENTS_VIEW);
  // `mutate`, not `mutateAsync`: nothing awaits this, and an unhandled
  // rejection from a read receipt would be a console error on a page that is
  // otherwise fine.
  const { mutate } = useMarkAnnouncementRead();
  const markedRef = useRef<ObjectId | null>(null);

  useEffect(() => {
    if (!announcement || !canView) return;
    if (announcement.readAt) return;
    if (markedRef.current === announcement.id) return;

    markedRef.current = announcement.id;
    mutate(announcement.id);
  }, [announcement, canView, mutate]);
}
