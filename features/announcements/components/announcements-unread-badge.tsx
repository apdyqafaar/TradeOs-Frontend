"use client";

import { useUnreadAnnouncementCount } from "../hooks/use-announcement-unread";

/**
 * Above this, the pill shows `9+`.
 *
 * A nav badge is a signal, not a figure. Past nine the exact number changes
 * nothing about what the reader does next, and three digits break the pill's
 * geometry in a 240px sidebar. The **real** number still goes to assistive
 * technology, because "9+ unread" is a worse sentence than "12 unread" and the
 * reason to cap it — pixels — does not apply there.
 */
const DISPLAY_CAP = 9;

export interface AnnouncementsUnreadBadgeProps {
  /** True in the rail. The label beside it is `sr-only`, so the pill has nowhere to sit. */
  collapsed?: boolean;
}

/**
 * The unread count on the Announcements item in the sidebar.
 *
 * **It renders nothing at all when there is nothing to say** — not a zero, not
 * an empty pill, not a placeholder while the query is in flight. `data` is
 * `undefined` while loading and on failure, and `0` is a real answer meaning
 * "you are up to date", and all three are the same thing on screen: absence.
 * A badge that appears empty and then fills in is a layout shift in the one
 * component that is on screen for the entire session.
 *
 * **It is announced as part of the link, never as a loose number.** A bare "3"
 * next to "Announcements" is read out as "Announcements 3", which could be a
 * count of anything. The `sr-only` span makes the anchor's accessible name
 * "Announcements, 3 unread" — one phrase, in the order a person would say it.
 * The visible pill is `aria-hidden`, so the number is not read twice.
 *
 * **The collapsed rail gets a dot instead of a pill.** There is no room for a
 * pill beside a 40px centred icon, and the label it would sit against is
 * `sr-only` there. The dot is positioned against the nav link, which is why
 * `nav.tsx` puts `relative` on that link. The `ring-sidebar` is not decoration:
 * without a ring in the sidebar's own colour the dot merges into the icon
 * beneath it at the exact moment the row is 40px wide.
 *
 * The query underneath is gated on `announcements:view` and fetches nothing
 * until the session has resolved — see `useUnreadAnnouncementCount`.
 */
export function AnnouncementsUnreadBadge({
  collapsed = false,
}: AnnouncementsUnreadBadgeProps) {
  const { data: count } = useUnreadAnnouncementCount();

  // `!count` covers all three of undefined (loading, or a failure this must
  // never surface in the chrome of every screen) and 0.
  if (!count) return null;

  return (
    <>
      <span className="sr-only">, {count} unread</span>
      {collapsed ? (
        <span
          aria-hidden="true"
          className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-sidebar"
        />
      ) : (
        <span
          aria-hidden="true"
          className="ml-auto min-w-5 flex-none rounded-full bg-primary-soft px-1.5 text-center font-medium font-mono text-[11px] text-primary-soft-foreground leading-5"
        >
          {count > DISPLAY_CAP ? `${DISPLAY_CAP}+` : count}
        </span>
      )}
    </>
  );
}
