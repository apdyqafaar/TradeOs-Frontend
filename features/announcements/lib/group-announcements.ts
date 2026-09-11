import { tz } from "@date-fns/tz";
import { differenceInCalendarDays } from "date-fns";
import type { DateInput } from "@/lib/format/date";
import type { Announcement } from "../types";

/**
 * The feed's time buckets, and the order they are drawn in.
 *
 * `pinned` is first and is **not** a time bucket — it is the server's own
 * ordering made visible. `GET /announcements` sorts `{ pinned: -1, createdAt:
 * -1, _id: -1 }` *before* it paginates, so pinned notices already occupy the
 * head of page 1 whatever their age; a feed that scattered them through
 * "Today" and "Earlier" by date would be re-ordering rows the server put in a
 * deliberate order and would look, correctly, like a bug.
 */
export type AnnouncementGroupKey =
  | "pinned"
  | "today"
  | "yesterday"
  | "thisWeek"
  | "earlier";

export interface AnnouncementGroup {
  key: AnnouncementGroupKey;
  /** Rendered as the section heading. Sentence case, no count. */
  label: string;
  items: Announcement[];
}

const ORDER: readonly { key: AnnouncementGroupKey; label: string }[] = [
  { key: "pinned", label: "Pinned" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisWeek", label: "Earlier this week" },
  { key: "earlier", label: "Earlier" },
];

/**
 * Has the calling member not read this notice yet?
 *
 * **`readAt === null`, deliberately, not `!readAt`.** The three read-tracking
 * endpoints are aggregates — a count, a receipt, a bulk mark — and none of them
 * says which rows in a page are unread. `Announcement.readAt` is therefore
 * optional: `null` means the API tracked it and the answer is "unread",
 * `undefined` means the list rows do not carry read state at all, and the only
 * honest thing to draw in that case is nothing.
 *
 * `!readAt` would collapse those two into "unread" and paint a dot on every row
 * in the feed the moment the field is missing — the exact failure that reads as
 * "this product thinks I have read nothing".
 */
export function isUnread(announcement: Announcement): boolean {
  return announcement.readAt === null;
}

/**
 * Which bucket a *non-pinned* notice belongs to, by calendar day in the
 * **business** timezone.
 *
 * Calendar days, not elapsed hours: a notice posted at 23:50 is "Yesterday" at
 * 00:10 the next morning, not "1 h ago, Today". And the shop's calendar day,
 * not the reader's — the same rule `formatRelative` and every report on this
 * product already follow, so the group heading and the timestamp under the
 * title can never disagree about which day it is.
 *
 * The three boundaries, and why each is where it is:
 *
 *   - **0 days → Today.** A *negative* difference lands here too. The server
 *     stamps `createdAt` and the browser supplies `now`, so a clock a few
 *     seconds apart makes a notice posted "in the future"; the alternative is a
 *     row that falls out of every bucket and vanishes from the feed.
 *   - **1 day → Yesterday.**
 *   - **2–6 days → Earlier this week**, meaning the last seven days rather than
 *     the current calendar week. There is no week-start convention anywhere in
 *     this frontend to honour — no `startOfWeek` call exists — and inventing one
 *     for a market where the working week may begin on Saturday, Sunday or
 *     Monday would be a guess printed as a fact. Seven days is also exactly
 *     where `formatRelative` stops saying "6 d ago" and starts printing an
 *     absolute date, so the heading changes on the same row the timestamps do.
 *   - **7+ days → Earlier.**
 */
function bucketOf(
  createdAt: string,
  timezone: string,
  now: DateInput,
): AnnouncementGroupKey {
  const days = differenceInCalendarDays(new Date(now), new Date(createdAt), {
    in: tz(timezone),
  });

  if (Number.isNaN(days)) return "earlier";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "thisWeek";
  return "earlier";
}

/**
 * The feed, grouped the way a real feed groups: pinned above everything, then
 * Today / Yesterday / Earlier this week / Earlier.
 *
 * Three properties this function guarantees, each of which a naive
 * implementation loses:
 *
 *   1. **Order inside a group is the order it was given.** The server's sort is
 *      the only ordering this feature has and the client cannot ask for
 *      another, so nothing here sorts.
 *   2. **Empty groups are dropped.** A page of one pinned notice renders one
 *      heading, not five.
 *   3. **Every input row comes out in exactly one group.** There is no bucket a
 *      row can fall out of — see the negative-difference note in `bucketOf`.
 *
 * `now` is a parameter so this is testable against a fixed clock, the same
 * shape `formatRelative` uses. Daylight-saving is handled by
 * `differenceInCalendarDays(..., { in: tz })`, which compares wall-clock days
 * in the zone rather than subtracting 24-hour spans — a 23-hour day would
 * otherwise round "yesterday evening" back into "Today".
 */
export function groupAnnouncements(
  items: Announcement[],
  timezone: string,
  now: DateInput = new Date(),
): AnnouncementGroup[] {
  const buckets = new Map<AnnouncementGroupKey, Announcement[]>();

  for (const announcement of items) {
    const key = announcement.pinned
      ? "pinned"
      : bucketOf(announcement.createdAt, timezone, now);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(announcement);
    else buckets.set(key, [announcement]);
  }

  return ORDER.flatMap(({ key, label }) => {
    const group = buckets.get(key);
    return group ? [{ key, label, items: group }] : [];
  });
}
