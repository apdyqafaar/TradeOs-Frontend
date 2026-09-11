"use client";

import { ArrowLeft, Megaphone, Pin, PinOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ButtonLink } from "@/components/shared/button-link";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime, formatRelative } from "@/lib/format/date";
import { useAnnouncement } from "../hooks/use-announcement";
import { useUpdateAnnouncement } from "../hooks/use-announcement-mutations";
import { useMarkAnnouncementReadOnView } from "../hooks/use-announcement-unread";
import type { Announcement } from "../types";
import { AnnouncementFormSheet } from "./announcement-form-sheet";
import { DeleteAnnouncementDialog } from "./delete-announcement-dialog";

/**
 * The two letters in the avatar circle.
 *
 * Guarded rather than assumed, because the API has two degenerate author cases
 * and both are real: `author.name` is the literal `"Removed member"` when the
 * User row is gone, and if `createdBy` fails to populate at all the whole
 * author is `{ id: "", name: "" }` — an **empty string, not null**
 * (`announcement.actions.ts:52-53,67-68`). `""` would produce an empty circle,
 * so it falls back to a glyph.
 *
 * Exported for its test.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

/**
 * The body, as paragraphs.
 *
 * `body` is **plain text**, max 5000 characters — the validator is
 * `z.string().trim().min(1).max(5000)` with no markdown or HTML anywhere in the
 * chain — so it is split on blank lines and rendered as text. Never
 * `dangerouslySetInnerHTML`: this is member-authored content in a multi-tenant
 * app, and the API does no sanitising because it never promised to store markup.
 *
 * Exported for its test.
 */
export function paragraphsOf(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

interface ReadingProps {
  announcement: Announcement;
  timezone: string;
}

/**
 * The reading layout itself.
 *
 * Split out from the loading and failure states below so the states stay
 * readable, and so a test can render a known row without a query client.
 *
 * ## What the 2026-09-10 redesign changed
 *
 * The brief fixes this at **max 720px with a serif title** (§351) and that has
 * not moved. What did:
 *
 * - **The actions left the byline.** Pin, Edit and Delete used to sit at the
 *   right-hand end of the author row, pushed there by a `flex-1` spacer — so
 *   the quietest line on the page carried its three loudest controls, and on a
 *   phone the byline wrapped into two ragged lines of mixed register. They are
 *   now a page toolbar opposite the back link, which is where a reader looks
 *   for them and where they wrap cleanly on their own.
 * - **The cover became a band, not a hero.** It was a full-width 16:9 panel
 *   *inside* the card's padding, so a notice about Friday's closing time opened
 *   with 400px of photograph. It is now a 180/240px band bled to the card's
 *   edges above the title, which supports the notice instead of replacing it.
 * - **The measure and the rhythm.** The body moved to 16px on 1.75 in a 720px
 *   column — about 66 characters, the middle of the comfortable range — with
 *   the paragraph gap tuned to the line height rather than left at a flat 16px.
 *
 * ## What did not change, and must not
 *
 * `body` is **plain text**, max 5000 characters — the validator is
 * `z.string().trim().min(1).max(5000)` with no markdown or HTML anywhere in the
 * chain. It is split on blank lines and rendered as text. Never
 * `dangerouslySetInnerHTML`: this is member-authored content in a multi-tenant
 * app, and the API does no sanitising because it never promised to store markup.
 */
function Reading({ announcement, timezone }: ReadingProps) {
  const router = useRouter();
  const { title, body, pinned, cover, author, createdAt, updatedAt } =
    announcement;

  const canUpdate = useCan(PERMISSIONS.ANNOUNCEMENTS_UPDATE);
  const canDelete = useCan(PERMISSIONS.ANNOUNCEMENTS_DELETE);

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pinIssue, setPinIssue] = useState<string | null>(null);

  const update = useUpdateAnnouncement();

  /*
   * Pin and unpin are a one-field PATCH — there is no `POST /pin` route
   * (contract §2, five endpoints and that is all).
   *
   * The body is written literally rather than through `announcementPatch`
   * because it already *is* a diff of exactly one field: nothing else on this
   * screen changed, and `pinned: false` is a real value that a truthiness
   * filter would drop. `PATCH { pinned: false }` is a legal, non-empty update
   * (contract §2.3).
   */
  const togglePin = () => {
    setPinIssue(null);
    update.mutate(
      { id: announcement.id, input: { pinned: !pinned } },
      {
        onError: (error: ApiError) => {
          // At the control that caused it (brief §8.4), not in a toast.
          setPinIssue(error.message);
        },
      },
    );
  };

  const edited = updatedAt !== createdAt;

  return (
    // The brief's 720px measure (§351), centred inside the shell's own
    // `max-w-[1280px]` main column. Everything on this screen — toolbar,
    // article, controls — shares it, so the eye tracks one left edge from the
    // back link to the last paragraph.
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      {/*
        The page toolbar: the way back on the left, the writes on the right.
        Its own row rather than the tail of the byline, which is what stops
        three controls from being the loudest thing in the quietest line and
        what lets them wrap on a phone without dragging the author's name with
        them.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <ButtonLink
          variant="ghost"
          size="sm"
          className="-ml-2 h-8 gap-1.5 px-2 text-[13px] text-muted-foreground"
          href={ROUTES.announcements}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Announcements
        </ButtonLink>

        <div className="flex items-center gap-0.5">
          {/*
            Hidden, never disabled (brief §1.1) — a Seller holds
            `announcements:view` and none of the three write permissions, and
            does not need to learn that editing is a thing this product does.

            Editing is **permission-based, not author-based**: anyone with
            `announcements:update` may edit anyone's notice and doing so does not
            reassign `createdBy` (contract §2.3, trap 12). So there is
            deliberately no "is this mine?" check here — adding one would hide a
            control the API allows.
          */}
          {canUpdate ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 font-medium text-[13px] text-muted-foreground"
                disabled={update.isPending}
                onClick={togglePin}
              >
                {pinned ? (
                  <PinOff className="size-3.5" aria-hidden="true" />
                ) : (
                  <Pin className="size-3.5" aria-hidden="true" />
                )}
                {pinned ? "Unpin" : "Pin"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 font-medium text-[13px] text-muted-foreground"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            </>
          ) : null}

          {canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 font-medium text-[13px] text-muted-foreground hover:text-destructive-strong"
              onClick={() => setDeleting(true)}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <article className="overflow-hidden rounded-xl border border-border bg-card">
        {cover ? (
          /*
            Plain `<img>`, not `next/image`: the S3 host comes from the API's
            environment and is unknown at build time, and `next/image` throws on
            an unconfigured host. `alt=""` because the `h1` below is the real
            label and the API stores no alt text.

            `url`, not `thumbUrl` — this is the 1600px original, the one place
            in the product where the full cover is shown at reading size.

            A fixed band bled to the card's edges rather than `aspect-video`
            inside the padding: at 720px wide, 16:9 is 405px of photograph
            before a reader reaches the first word. 240px is a header image;
            405px is the page.
          */
          // biome-ignore lint/performance/noImgElement: see the note above
          <img
            src={cover.url}
            alt=""
            aria-hidden="true"
            className="h-[180px] w-full border-border border-b object-cover sm:h-[240px]"
          />
        ) : null}

        <div className="flex flex-col gap-5 p-6 sm:p-9">
          {pinned ? (
            <div className="flex items-center gap-2">
              <Pin className="size-3.5 text-primary" aria-hidden="true" />
              <span className="font-medium font-mono text-[11px] text-primary uppercase tracking-[0.08em]">
                Pinned
              </span>
            </div>
          ) : null}

          <h1 className="text-balance font-serif text-[32px] text-foreground leading-[1.1] sm:text-[40px]">
            {title}
          </h1>

          {/*
            Informational only now. The avatar stays here — it is the one place
            in this feature with room for it, and a reading view is where a
            reader wants to know who is talking to them — but it sits at 24px
            rather than 28px, and the whole line sits a step down the palette
            from the title above it.
          */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-border border-b pb-5">
            <span
              aria-hidden="true"
              className="flex size-6 flex-none items-center justify-center rounded-full bg-info-soft font-mono text-[10px] text-info-soft-foreground"
            >
              {initialsOf(author.name)}
            </span>
            <span className="text-[13px] text-foreground">
              {/* The API's own fallback string when the User row is gone; an
                  empty name means the populate failed entirely. */}
              {author.name || "Unknown member"}
            </span>
            <time
              dateTime={createdAt}
              // The absolute instant in the tooltip, the relative one on
              // screen: "2 h ago" is what a reader wants and
              // "07 Sep 2026 14:32" is what somebody arguing about when a
              // notice went up wants.
              title={formatDateTime(createdAt, timezone)}
              className="font-mono text-[12px] text-muted-2"
            >
              {formatRelative(createdAt, timezone)}
            </time>
            {edited ? (
              <span
                title={formatDateTime(updatedAt, timezone)}
                className="font-mono text-[12px] text-muted-3"
              >
                · edited
              </span>
            ) : null}
          </div>

          {pinIssue ? (
            <p
              role="alert"
              className="rounded-[10px] border border-destructive/40 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong"
            >
              {pinIssue}
            </p>
          ) : null}

          {/*
            The measure: 16px on 1.75 inside a 720px column is roughly 66
            characters a line, which is the middle of the range prose is
            comfortable at. The paragraph gap is expressed in `em` so it stays
            proportional to the line height rather than drifting if the size
            ever moves — the classic "one blank line between paragraphs"
            spacing rather than a flat 16px that looks tight under 28px lines.
          */}
          <div className="flex flex-col gap-[0.9em] text-[16px] leading-[1.75]">
            {paragraphsOf(body).map((paragraph) => (
              <p
                key={paragraph}
                // `whitespace-pre-line` keeps single newlines inside a
                // paragraph, which is how a list of bullet-ish lines someone
                // typed survives.
                className="whitespace-pre-line text-pretty text-foreground"
              >
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </article>

      {canUpdate ? (
        <AnnouncementFormSheet
          open={editing}
          onOpenChange={setEditing}
          announcement={announcement}
        />
      ) : null}

      {canDelete ? (
        <DeleteAnnouncementDialog
          announcement={announcement}
          open={deleting}
          onOpenChange={setDeleting}
          // Back to the feed: the row this screen is about no longer exists, and
          // `useDeleteAnnouncement` has already removed its cache entry, so
          // staying here would refetch a 404.
          onDeleted={() => router.push(ROUTES.announcements)}
        />
      ) : null}
    </div>
  );
}

export interface AnnouncementDetailProps {
  announcementId: ObjectId;
}

/**
 * One announcement, read — artboard `2m`.
 *
 * **One request fills this whole screen.** `GET /announcements/:id` answers the
 * populated shape, `author: { id, name }` included (contract §2.4), so unlike
 * every other detail screen in this app there is no second fetch to put a name
 * on the byline. `useOrganization()` supplies the timezone, which every date
 * here needs and none of them may default.
 *
 * Four states, and each one says something different:
 *
 *   - **404** is not an error card. This feature hard-deletes, so a link shared
 *     in a chat can genuinely point at a notice somebody removed — that is an
 *     answer, and it gets the empty state's quiet language plus a way back,
 *     not a red panel with a request id support cannot use.
 *   - **403** is `ForbiddenScreen`. It should be unreachable —
 *     `announcements:view` is held by every preset (contract §5) — so arriving
 *     here means a custom role was built without it.
 *   - Anything else is the inline error card **with the request id**, retryable.
 *   - Loading is a skeleton in the shape of the article, so the page does not
 *     jump when it lands.
 *
 * **Opening this screen is what marks a notice read.** Not hovering it in the
 * feed, not the badge being seen — arriving at the thing and being shown it.
 * The hook is called before the early returns, as every hook must be, and takes
 * the loaded row rather than the id precisely so that the 403 and 404 branches
 * above never post a receipt for something the caller was not shown. See
 * `useMarkAnnouncementReadOnView` for the four guards.
 */
export function AnnouncementDetail({
  announcementId,
}: AnnouncementDetailProps) {
  const { timezone, isLoading: organizationLoading } = useOrganization();
  const { data, error, isPending, refetch } = useAnnouncement(announcementId);

  // Unconditional, above every early return: `data` is `undefined` until the
  // row lands and the hook does nothing until it has one.
  useMarkAnnouncementReadOnView(data);

  if (error?.status === 403) return <ForbiddenScreen />;

  if (error?.status === 404) {
    return (
      <EmptyState
        title="This announcement is gone"
        description="It was deleted, or the link points somewhere that never existed. Announcements cannot be restored."
        icon={Megaphone}
        action={
          <ButtonLink variant="outline" href={ROUTES.announcements}>
            Back to announcements
          </ButtonLink>
        }
      />
    );
  }

  if (error) {
    return (
      <ErrorCard
        error={error}
        title="Couldn't load this announcement"
        retry={() => {
          void refetch();
        }}
      />
    );
  }

  // The timezone is held back with the row: a date that shifts a day, or a
  // "2 h ago" that corrects itself, a beat after the notice appears reads as a
  // bug. `useOrganization` reports `"UTC"` while it loads, which is a real zone
  // and therefore a silent lie if it escapes onto the screen.
  if (isPending || organizationLoading || !data) {
    return (
      <div
        aria-hidden="true"
        className="mx-auto flex w-full max-w-[720px] flex-col gap-4"
      >
        <Skeleton className="h-8 w-40" />
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {/* No cover skeleton. Most notices have none, and a 240px grey band
              that vanishes when the row lands is a bigger jump than the one it
              was drawn to prevent. */}
          <div className="flex flex-col gap-5 p-6 sm:p-9">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-6 w-52" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      </div>
    );
  }

  return <Reading announcement={data} timezone={timezone} />;
}
