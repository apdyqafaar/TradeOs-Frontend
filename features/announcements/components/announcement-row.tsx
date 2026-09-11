"use client";

import { cn } from "cn";
import { Pin } from "lucide-react";
import Link from "next/link";
import { ROUTES } from "@/config/routes";
import { formatDateTime, formatRelative } from "@/lib/format/date";
import { isUnread } from "../lib/group-announcements";
import type { Announcement } from "../types";

/**
 * How much of the body the feed shows before the reading screen takes over.
 *
 * A hard character budget rather than a CSS `line-clamp` alone, and both are
 * used: the clamp handles a body that is one long paragraph, and this handles a
 * 5000-character notice whose first two lines would otherwise ship in full to
 * every row on the page.
 *
 * 160 rather than the 220 the card used. The row is wider than the old card's
 * text column but the excerpt is now the *third* thing in the hierarchy rather
 * than the second, and two tight lines under a strong title read as a summary
 * where four loose ones read as the notice itself.
 *
 * Exported for its test: the ellipsis rule is the sort of thing that quietly
 * starts cutting mid-word.
 */
const EXCERPT_LIMIT = 160;

/**
 * The first couple of lines of a notice, as prose rather than as markup.
 *
 * `body` is plain text, max 5000 characters — not markdown and not HTML
 * (`announcement.validation.ts:29`) — so it is rendered as text everywhere and
 * never through `dangerouslySetInnerHTML`. Newlines are collapsed here because
 * a row is two lines tall and a body that starts with a blank line would
 * otherwise show an empty excerpt.
 */
export function excerptOf(body: string, limit = EXCERPT_LIMIT): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;

  // Cut at the last space inside the budget so the ellipsis follows a whole
  // word. `lastIndexOf` on a slice one character longer than the budget is what
  // makes a limit landing exactly on a space cut cleanly rather than one word
  // early.
  const cut = flat.slice(0, limit + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : flat.slice(0, limit)).trimEnd()}…`;
}

export interface AnnouncementRowProps {
  announcement: Announcement;
  /** IANA zone from `useOrganization()`. There is no safe default (CLAUDE.md). */
  timezone: string;
}

/**
 * One notice in the feed.
 *
 * **This replaced a card** on 2026-09-10. The old shape was a bordered card per
 * notice, each opening with a full-bleed 150px cover — so a page of five
 * notices was five hero images and the titles, which are the thing anybody came
 * for, were the smallest text on screen. The row inverts that: the title
 * carries it, a proportional thumbnail sits beside the text instead of above
 * it, and the metadata drops to the quietest tone in the palette.
 *
 * Three pieces of geometry are load-bearing rather than decorative:
 *
 * - **`relative`** on the `<li>`. The title's link stretches an `::after` over
 *   the whole row; without a positioned ancestor that pseudo-element would
 *   cover the viewport instead.
 * - **The 14px first column** is a permanent gutter, held whether or not
 *   anything is in it, so every title in the feed starts on the same vertical
 *   line and an unread dot appearing does not shift the row it marks.
 * - **`pointer-events-none` on the thumbnail.** It is painted after the link's
 *   stretched `::after` in DOM order, so without this the one part of the row
 *   most likely to be tapped on a phone would be the one part that is not a
 *   link.
 *
 * **The author's name is on the wire.** `author: { id, name }` is populated on
 * every read (contract §2.4), which is why this names a person with no second
 * request. The avatar circle those initials used to sit in has moved to the
 * reading view alone: on a row it was a second visual anchor competing with the
 * title for the same glance, and the name in words says more than two letters.
 *
 * `formatRelative` takes the **business** timezone, threaded down from
 * `useOrganization()` by the list rather than read from the browser: a notice
 * posted at 23:30 in Nairobi is "2 h ago" to the shop, whoever is reading it.
 * The absolute instant rides along in `title`, which is what somebody arguing
 * about when a notice went up wants.
 *
 * The pin is an icon with an accessible name, not a decorative glyph. "Pinned"
 * is real state a screen reader has to be able to reach, and although pinned
 * notices now also sit under a "Pinned" heading, a row has to be able to say
 * what it is without its neighbours.
 */
export function AnnouncementRow({
  announcement,
  timezone,
}: AnnouncementRowProps) {
  const { id, title, body, pinned, cover, author, createdAt } = announcement;
  const unread = isUnread(announcement);

  return (
    <li className="relative border-border border-b transition-colors last:border-b-0 hover:bg-accent/60 has-[a:focus-visible]:bg-accent/60">
      <div className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-x-3 px-3.5 py-4 sm:gap-x-4 sm:px-[18px]">
        {/*
          The unread gutter. `readAt === null` is the only thing that lights it:
          an absent field means the API does not track read state per row, and
          the honest answer to "which of these have I read?" is then nothing at
          all rather than a dot on every one. See `isUnread`.
        */}
        <span className="flex h-[22px] items-center justify-center">
          {unread ? (
            <span
              aria-hidden="true"
              className="size-[7px] rounded-full bg-primary"
            />
          ) : null}
        </span>

        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-start gap-2">
            {pinned ? (
              <Pin
                className="mt-[5px] size-3.5 flex-none text-primary"
                aria-label="Pinned"
              />
            ) : null}
            <h3
              className={cn(
                "text-[15px] text-foreground leading-[1.45]",
                // The second unread affordance, and the one that survives a
                // reader who cannot see the dot's colour. Read notices are not
                // dimmed — a notice you have read is still a notice.
                unread ? "font-semibold" : "font-medium",
              )}
            >
              <Link
                href={ROUTES.announcement(id)}
                // `after:absolute inset-0` turns the whole row into the link's
                // hit area while keeping the anchor's accessible name to the
                // title alone — a wrapping <a> would read the excerpt and the
                // timestamp out as part of the link text.
                className="rounded-sm after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {title}
              </Link>
              {unread ? <span className="sr-only"> — unread</span> : null}
            </h3>
          </div>

          <p className="line-clamp-2 text-[13px] text-muted-foreground leading-[1.6]">
            {excerptOf(body)}
          </p>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-[12px] text-muted-2">
              {/* The API's own fallback string when the User row is gone; an
                  empty name means the populate failed entirely. */}
              {author.name || "Unknown member"}
            </span>
            <span aria-hidden="true" className="text-[12px] text-muted-3">
              ·
            </span>
            <time
              dateTime={createdAt}
              title={formatDateTime(createdAt, timezone)}
              className="font-mono text-[11px] text-muted-3"
            >
              {formatRelative(createdAt, timezone)}
            </time>
          </div>
        </div>

        {cover ? (
          /*
            A plain `<img>`, not `next/image`, for the reason spelled out in
            `features/uploads/components/image-picker.tsx`: the S3 host comes
            from the API's environment and is unknown at build time — which is
            every development machine — and `next/image` throws on an
            unconfigured host.

            `alt=""` and `aria-hidden` because the cover is decorative here: the
            title beside it is the real label, and a screen reader that
            announced the image would read the notice's name twice. The API
            stores no alt text (`announcement.model.ts` has no such field), so
            there is nothing truer to put here.

            `thumbUrl`, not `url` — the 1600px original belongs to the reading
            screen. At 88×60 this is under a tenth of the pixels the old
            full-bleed cover shipped per row.
          */
          // biome-ignore lint/performance/noImgElement: see the note above
          <img
            src={cover.thumbUrl}
            alt=""
            aria-hidden="true"
            className="pointer-events-none h-[52px] w-[68px] flex-none rounded-md border border-border object-cover sm:h-[60px] sm:w-[88px]"
          />
        ) : null}
      </div>
    </li>
  );
}
