"use client";

import { Pin } from "lucide-react";
import Link from "next/link";
import { ROUTES } from "@/config/routes";
import { formatRelative } from "@/lib/format/date";
import type { Announcement } from "../types";

/**
 * How much of the body the feed shows before the reading screen takes over.
 *
 * A hard character budget rather than a CSS `line-clamp` alone, and both are
 * used: the clamp handles a body that is one long paragraph, and this handles a
 * 5000-character notice whose first two lines would otherwise ship in full to
 * every card on the page. 220 is roughly the two lines the artboard draws at
 * 13px across a 720px card.
 */
const EXCERPT_LIMIT = 220;

/**
 * The first couple of lines of a notice, as prose rather than as markup.
 *
 * `body` is plain text, max 5000 characters — not markdown and not HTML
 * (`announcement.validation.ts:29`) — so it is rendered as text everywhere and
 * never through `dangerouslySetInnerHTML`. Newlines are collapsed here because
 * a card is two lines tall and a body that starts with a blank line would
 * otherwise show an empty excerpt.
 *
 * Exported for its test: the ellipsis rule is the sort of thing that quietly
 * starts cutting mid-word.
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

export interface AnnouncementCardProps {
  announcement: Announcement;
  /** IANA zone from `useOrganization()`. There is no safe default (CLAUDE.md). */
  timezone: string;
}

/**
 * One card in the feed — artboard `2m`, the left panel.
 *
 * The whole card is a link to the reading screen. One link, wrapping the
 * heading, rather than a card with a "Read more" anchor in the corner: the
 * artboard draws no such control, and a 150px cover with a title under it is
 * already the affordance.
 *
 * **The author's name is on the wire.** `author: { id, name }` is populated on
 * every read (contract §2.4), which is why this card names a person with no
 * second request — the one shape in this pair of features that can. A card
 * written against the project shape would render `undefined` here.
 *
 * `formatRelative` takes the **business** timezone, threaded down from
 * `useOrganization()` by the list rather than read from the browser: a notice
 * posted at 23:30 in Nairobi is "2 h ago" to the shop, whoever is reading it.
 *
 * The pin is an icon with an accessible name, not a decorative glyph. "Pinned"
 * is real state a screen reader has to be able to reach, and it is the only
 * state flag an announcement has.
 */
export function AnnouncementCard({
  announcement,
  timezone,
}: AnnouncementCardProps) {
  const { id, title, body, pinned, cover, author, createdAt } = announcement;

  return (
    // `relative` is load-bearing, not cosmetic: the title's link stretches an
    // `::after` over the whole card, and without a positioned ancestor that
    // pseudo-element would cover the viewport instead.
    <article className="relative flex flex-col overflow-hidden rounded-[10px] border border-border bg-card transition-colors hover:border-border-strong">
      {cover ? (
        /*
          A plain `<img>`, not `next/image`, for the reason spelled out in
          `features/uploads/components/image-picker.tsx`: the S3 host comes from
          the API's environment and is unknown at build time — which is every
          development machine — and `next/image` throws on an unconfigured host.

          `alt=""` and `aria-hidden` because the cover is decorative here: the
          title immediately below is the real label, and a screen reader that
          announced the image would read the notice's name twice. The API stores
          no alt text (`announcement.model.ts` has no such field), so there is
          nothing truer to put here.
        */
        // biome-ignore lint/performance/noImgElement: see the note above
        <img
          src={cover.thumbUrl}
          alt=""
          aria-hidden="true"
          className="h-[150px] w-full border-border border-b object-cover"
        />
      ) : null}

      <div className="flex flex-col gap-[9px] p-[18px]">
        <div className="flex items-center gap-[9px]">
          {pinned ? (
            <Pin
              className="size-[15px] flex-none text-primary"
              aria-label="Pinned"
            />
          ) : null}
          <h2 className="font-medium text-[17px] text-foreground leading-snug">
            <Link
              href={ROUTES.announcement(id)}
              // `after:absolute inset-0` turns the whole card into the link's
              // hit area while keeping the anchor's accessible name to the
              // title alone — a wrapping <a> would read the excerpt and the
              // timestamp out as part of the link text.
              className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {title}
            </Link>
          </h2>
        </div>

        <div className="flex items-center gap-[9px]">
          <span className="text-[12px] text-muted-foreground">
            {author.name}
          </span>
          <time
            dateTime={createdAt}
            className="font-mono text-[11px] text-muted-3"
          >
            {formatRelative(createdAt, timezone)}
          </time>
        </div>

        <p className="text-[13px] text-muted-foreground leading-[1.6]">
          {excerptOf(body)}
        </p>
      </div>
    </article>
  );
}
