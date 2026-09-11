"use client";

import { cn } from "cn";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Plus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { parseAsInteger, useQueryStates } from "nuqs";
import { type ReactNode, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import type { ApiError } from "@/lib/api/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  useMarkAllAnnouncementsRead,
  useUnreadAnnouncementCount,
} from "../hooks/use-announcement-unread";
import { useAnnouncements } from "../hooks/use-announcements";
import { groupAnnouncements } from "../lib/group-announcements";
import { AnnouncementFormSheet } from "./announcement-form-sheet";
import { AnnouncementRow } from "./announcement-row";

/**
 * The whole URL state of this screen, and it is one key.
 *
 * `listAnnouncementsQuerySchema` is `{ ...paginationQuerySchema.shape }` and
 * `.strict()` — `page` and `limit`, nothing else (contract §2.1). So there is
 * **no search box and no filter strip on this page**, and that is a constraint
 * rather than an omission: `?search=x` is a 422 `Unrecognized key`, and a
 * client-side filter over one page of twenty would confidently lie about the
 * nineteen pages it cannot see.
 *
 * The same rule rules out an "Unread only" toggle, which the 2026-09-10
 * redesign wanted and could not have: read state is three aggregate endpoints
 * and no query parameter.
 *
 * `limit` is left off the URL too. Nothing on screen could change it, and a
 * URL-only knob that silently resizes the feed is a worse answer than a fixed
 * page — the server's default of 20 is what this asks for by omission.
 *
 * `history: "replace"` so paging through the feed does not stack a back-button
 * entry per page.
 */
const FILTER_PARSERS = { page: parseAsInteger.withDefault(1) };

/** How many row skeletons to draw. */
const SKELETON_COUNT = 4;

/**
 * The announcements feed.
 *
 * **This is the one list screen every member can open.**
 * `announcements:view` is held by all three presets — Owner by wildcard,
 * Manager by `ALL_PERMISSIONS`, and Seller explicitly at
 * `lib/permissions.ts:133` (contract §5) — which is why `/announcements` has
 * no row in `ROUTE_PERMISSIONS` and why the gating here is entirely on the
 * *controls*, not on the page.
 *
 * ## What the 2026-09-10 redesign changed, and why
 *
 * It was a vertical stack of bordered cards, each opening with a full-bleed
 * 16:9 cover. Five notices were five hero images; the titles, which are what
 * anybody came for, were the smallest thing on screen and the page read as a
 * wireframe of a blog rather than as the place a shop puts its notices.
 *
 * - **Time groups.** Pinned above everything — which is the server's own sort
 *   made legible, not a client-side re-order — then Today / Yesterday / Earlier
 *   this week / Earlier. A feed with no dates on it is a pile; the headings are
 *   what turn twenty rows into "three things happened today".
 * - **One surface per group**, hairline-separated rows, instead of a card per
 *   notice. The same idiom the Overview's panels and the reports' breakdown
 *   lists already use.
 * - **The cover became an 88×60 thumbnail beside the text**, so the image
 *   supports the notice instead of announcing it, and every title in the feed
 *   starts on the same line whether or not one exists.
 * - **The metadata receded** a step in the palette and moved below the excerpt.
 *
 * ## The states
 *
 * Every list state brief §8.4 asks for is handled: a loading skeleton, an empty
 * state, an error card carrying the request id, and a 403. There is
 * deliberately **no filtered-empty state**, because there is no filter to
 * clear — an empty feed on page 1 means the business has never posted, and an
 * empty page 2 means somebody deleted rows out from under a stale page, which
 * the "Back to the newest" action fixes.
 *
 * The sixth state — a domain 409 shown where the action was taken — has nothing
 * to attach to here: announcements have no conflict conditions at all (contract
 * §7). The refusals that exist all come from covers and all belong to the form
 * sheet, which is where they are rendered.
 *
 * **The order is the server's and cannot be changed**: pinned first, then
 * newest, applied *before* pagination. So pins occupy the head of page 1 and
 * push older notices onto page 2, with no cap on how many may be pinned — which
 * is exactly why the Pinned group can hold a notice from March while "Today"
 * sits below it.
 */
export function AnnouncementsPage() {
  const router = useRouter();
  const [{ page }, setFilters] = useQueryStates(FILTER_PARSERS, {
    history: "replace",
  });

  const canCreate = useCan(PERMISSIONS.ANNOUNCEMENTS_CREATE);
  const [composing, setComposing] = useState(false);

  /*
   * Only the timezone, and it has no safe default. Every row carries a
   * relative timestamp resolved in the *business's* day, and every group
   * heading is a calendar day in that same zone — a notice posted at 23:30 in
   * Nairobi is "Yesterday" to the shop at 00:10, whoever is reading it. So the
   * feed is held back until the zone lands rather than grouped against the
   * "UTC" fallback, which is a real zone and would therefore look correct
   * while putting rows under the wrong heading.
   *
   * No currency: there is no money anywhere on this screen.
   */
  const { timezone, isLoading: organizationLoading } = useOrganization();

  const { data, error, isPending, isPlaceholderData, refetch } =
    useAnnouncements({ page });

  const { data: unreadCount } = useUnreadAnnouncementCount();
  const markAllRead = useMarkAllAnnouncementsRead();
  const [markAllIssue, setMarkAllIssue] = useState<string | null>(null);

  // A 403 is not a failure to retry: nothing broke, the caller simply may not
  // read this. It should be unreachable — every preset holds
  // `announcements:view` — so arriving here means a custom role was built
  // without it.
  if (error?.status === 403) return <ForbiddenScreen />;

  const items = data?.items ?? [];
  const meta = data?.meta;
  const loading = isPending || organizationLoading;
  const groups = groupAnnouncements(items, timezone);
  const unread = unreadCount ?? 0;

  const onMarkAllRead = () => {
    setMarkAllIssue(null);
    markAllRead.mutate(undefined, {
      // At the control that caused it (brief §8.4), not in a toast.
      onError: (failure: ApiError) => setMarkAllIssue(failure.message),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-serif text-[32px] text-foreground leading-[1.1]">
            Announcements
          </h1>
          <p className="flex flex-wrap items-center gap-2">
            {meta ? (
              <span className="font-mono text-[13px] text-muted-foreground">
                {meta.total === 1 ? "1 notice" : `${meta.total} notices`}
              </span>
            ) : null}
            {/*
              The count is the *member's own* and is org-scoped server-side, so
              it is the same number the sidebar badge shows and there is no way
              for the two to disagree: they are one query.
            */}
            {unread > 0 ? (
              <>
                {meta ? (
                  <span
                    aria-hidden="true"
                    className="font-mono text-[13px] text-muted-3"
                  >
                    ·
                  </span>
                ) : null}
                <span className="font-mono text-[13px] text-primary">
                  {unread === 1 ? "1 unread" : `${unread} unread`}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/*
            Only when there is something to mark. A control that is present but
            does nothing teaches people to ignore it, and this one has no
            useful disabled state — "you have read everything" is better said
            by the control's absence than by a greyed-out button.
          */}
          {unread > 0 ? (
            <Button
              variant="outline"
              className="h-10 rounded-[10px] px-3.5 text-[13px]"
              disabled={markAllRead.isPending}
              onClick={onMarkAllRead}
            >
              <Check className="size-4" aria-hidden="true" />
              Mark all as read
            </Button>
          ) : null}

          {/*
            Hidden, never disabled (brief §1.1). The Seller preset holds
            `announcements:view` but not `announcements:create`, and a seller does
            not need to learn that posting a notice is a thing this product does.

            `useCan` rather than `<PermissionGate>` because that component renders
            nothing while the session loads, which would pop the button in after
            the heading has settled.
          */}
          {canCreate ? (
            <Button
              className="h-10 rounded-[10px] px-4 text-[13px]"
              onClick={() => setComposing(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              New announcement
            </Button>
          ) : null}
        </div>
      </header>

      {markAllIssue ? (
        <p
          role="alert"
          className="rounded-[10px] border border-destructive/40 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong"
        >
          {markAllIssue}
        </p>
      ) : null}

      {error ? (
        <ErrorCard
          error={error}
          title="Couldn't load the announcements"
          retry={() => {
            void refetch();
          }}
        />
      ) : null}

      {/*
        A failure with nothing cached renders the card alone. An empty feed
        under it would read as "nobody has posted anything" rather than "we
        could not ask", which is the wrong thing to tell someone looking for the
        notice they were told to read.
      */}
      {error && !data ? null : loading ? (
        <FeedSkeleton />
      ) : items.length === 0 ? (
        page > 1 ? (
          <EmptyPanel>
            <EmptyState
              title="Nothing on this page"
              description="Announcements were removed while this page was open."
              icon={Megaphone}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void setFilters({ page: 1 })}
                >
                  Back to the newest
                </Button>
              }
            />
          </EmptyPanel>
        ) : (
          <EmptyPanel>
            <EmptyState
              title="No announcements yet"
              description="Shift changes, stock takes, price updates — anything the whole business needs to know lands here, newest first, with the important ones pinned to the top."
              icon={Megaphone}
              action={
                canCreate ? (
                  <Button onClick={() => setComposing(true)}>
                    <Plus className="size-4" aria-hidden="true" />
                    New announcement
                  </Button>
                ) : undefined
              }
            />
          </EmptyPanel>
        )
      ) : (
        <div
          className={cn(
            "flex flex-col gap-6 transition-opacity",
            // Stale rows stay on screen while the next page loads, dimmed
            // rather than blanked — `keepPreviousData` in the hook is what
            // makes that possible.
            isPlaceholderData && "opacity-60",
          )}
        >
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-2">
              <h2 className="px-1 font-medium font-mono text-[11px] text-muted-2 uppercase tracking-[0.08em]">
                {group.label}
              </h2>
              <ul className="overflow-hidden rounded-[10px] border border-border bg-card">
                {group.items.map((announcement) => (
                  <AnnouncementRow
                    key={announcement.id}
                    announcement={announcement}
                    timezone={timezone}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 ? (
        <nav
          aria-label="Announcement pages"
          className="flex items-center justify-between gap-3"
        >
          <span className="font-mono text-[12px] text-muted-2">
            Page {meta.page} of {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1 || isPlaceholderData}
              onClick={() => void setFilters({ page: meta.page - 1 })}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Newer
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages || isPlaceholderData}
              onClick={() => void setFilters({ page: meta.page + 1 })}
            >
              Older
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : null}

      {/*
        One sheet, mounted only for someone who may use it. Creating navigates
        straight to the new notice — the reading screen is where the pin, edit
        and delete controls live, and a person who has just written something
        wants to see it as everyone else will.
      */}
      {canCreate ? (
        <AnnouncementFormSheet
          open={composing}
          onOpenChange={setComposing}
          onSaved={(announcement) =>
            router.push(ROUTES.announcement(announcement.id))
          }
        />
      ) : null}
    </div>
  );
}

/**
 * The empty feed, given a shape rather than left as text floating on the page
 * ground.
 *
 * **Dashed, not solid.** `EmptyState`'s own docblock argues that a bordered
 * card reads as an error, and it is right about a solid one — but a feed that
 * has never had a row in it still needs to look like the place rows will
 * appear. A dashed outline is the difference between "something is wrong here"
 * and "nothing here yet", and it is the same vocabulary the reports brief uses
 * for a panel that is reserved rather than broken.
 */
function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-border border-dashed bg-card/40">
      {children}
    </div>
  );
}

/**
 * The loading state, drawn in the shape of the thing that is coming: a group
 * heading and four rows, not four cards.
 *
 * `aria-hidden` with one `sr-only` live region rather than a wall of announced
 * placeholder boxes — a screen reader should hear "Loading announcements",
 * once. `<output>` rather than `role="status"`, which biome's
 * `useSemanticElements` rejects (`docs/FINDINGS.md` §4).
 */
function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <output className="sr-only">Loading announcements</output>
      <Skeleton className="ml-1 h-3 w-16" />
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-[10px] border border-border bg-card"
      >
        {Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder rows with no identity of their own, never reordered
            key={index}
            className="flex items-start gap-4 border-border border-b px-[18px] py-4 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-[60px] w-[88px] flex-none rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
