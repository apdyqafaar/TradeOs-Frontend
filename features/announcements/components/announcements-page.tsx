"use client";

import { cn } from "cn";
import { ChevronLeft, ChevronRight, Megaphone, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { parseAsInteger, useQueryStates } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { useAnnouncements } from "../hooks/use-announcements";
import { AnnouncementCard } from "./announcement-card";
import { AnnouncementFormSheet } from "./announcement-form-sheet";

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
 * `limit` is left off the URL too. Nothing on screen could change it, and a
 * URL-only knob that silently resizes the feed is a worse answer than a fixed
 * page — the server's default of 20 is what this asks for by omission.
 *
 * `history: "replace"` so paging through the feed does not stack a back-button
 * entry per page.
 */
const FILTER_PARSERS = { page: parseAsInteger.withDefault(1) };

/** How many card skeletons to draw. The artboard shows three. */
const SKELETON_COUNT = 3;

/**
 * The announcements feed — artboard `2m`, the left panel.
 *
 * **This is the one list screen every member can open.**
 * `announcements:view` is held by all three presets — Owner by wildcard,
 * Manager by `ALL_PERMISSIONS`, and Seller explicitly at
 * `lib/permissions.ts:133` (contract §5) — which is why `/announcements` has
 * no row in `ROUTE_PERMISSIONS` and why the gating here is entirely on the
 * *controls*, not on the page.
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
 * push older notices onto page 2, with no cap on how many may be pinned.
 */
export function AnnouncementsPage() {
  const router = useRouter();
  const [{ page }, setFilters] = useQueryStates(FILTER_PARSERS, {
    history: "replace",
  });

  const canCreate = useCan(PERMISSIONS.ANNOUNCEMENTS_CREATE);
  const [composing, setComposing] = useState(false);

  /*
   * Only the timezone, and it has no safe default. Every card carries a
   * relative timestamp resolved in the *business's* day — a notice posted at
   * 23:30 in Nairobi is "2 h ago" to the shop whoever is reading it — so the
   * cards are held back until it lands rather than rendered against the "UTC"
   * fallback, which is a real zone and would therefore look correct while being
   * wrong.
   *
   * No currency: there is no money anywhere on this screen.
   */
  const { timezone, isLoading: organizationLoading } = useOrganization();

  const { data, error, isPending, isPlaceholderData, refetch } =
    useAnnouncements({ page });

  // A 403 is not a failure to retry: nothing broke, the caller simply may not
  // read this. It should be unreachable — every preset holds
  // `announcements:view` — so arriving here means a custom role was built
  // without it.
  if (error?.status === 403) return <ForbiddenScreen />;

  const items = data?.items ?? [];
  const meta = data?.meta;
  const loading = isPending || organizationLoading;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-[32px] text-foreground leading-[1.1]">
            Announcements
          </h1>
          {meta ? (
            <span className="font-mono text-[13px] text-muted-foreground">
              {meta.total === 1 ? "1 notice" : `${meta.total} notices`}
            </span>
          ) : null}
        </div>

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
      </header>

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
        <div className="flex flex-col gap-4">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder cards with no identity of their own, never reordered
              key={index}
              className="h-[188px] w-full rounded-[10px]"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        page > 1 ? (
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
        ) : (
          <EmptyState
            title="No announcements yet"
            description="Shift changes, stock takes, price updates — anything the whole business needs to know lands here."
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
        )
      ) : (
        <div
          className={cn(
            "flex flex-col gap-4 transition-opacity",
            // Stale rows stay on screen while the next page loads, dimmed
            // rather than blanked — `keepPreviousData` in the hook is what
            // makes that possible.
            isPlaceholderData && "opacity-60",
          )}
        >
          {items.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              timezone={timezone}
            />
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
