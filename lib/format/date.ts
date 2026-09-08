import { tz } from "@date-fns/tz";
import {
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  format,
} from "date-fns";

/**
 * Dates rendered in the **business** timezone (brief §8.2).
 *
 * Every one of these takes an IANA zone rather than reading the browser's,
 * because a shop's day is its own: a sale at 23:30 in Nairobi belongs to that
 * day's takings even when the owner is looking at the report from London, and
 * the API's own period aggregation (`Backend/src/lib/period.ts`) already
 * resolves `today`, `week` and `month` that way. Reading the browser's zone
 * here would put the UI's day boundary in a different place from the report's.
 *
 * `date-fns` + `@date-fns/tz` are the same libraries the backend uses, so the
 * two agree on what a calendar day is.
 */

export type DateInput = Date | string | number;

/** What a table cell shows when a nullable date is absent or malformed. */
const PLACEHOLDER = "—";

const toDate = (value: DateInput): Date | null => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** `"07 Sep 2026"` — the table format. */
export function formatDate(value: DateInput, timeZone: string): string {
  const date = toDate(value);
  return date ? format(date, "dd MMM yyyy", { in: tz(timeZone) }) : PLACEHOLDER;
}

/** `"14:32"` — 24-hour, because receipts and shifts are read, not spoken. */
export function formatTime(value: DateInput, timeZone: string): string {
  const date = toDate(value);
  return date ? format(date, "HH:mm", { in: tz(timeZone) }) : PLACEHOLDER;
}

/** `"07 Sep 2026 14:32"`. */
export function formatDateTime(value: DateInput, timeZone: string): string {
  const date = toDate(value);
  return date
    ? format(date, "dd MMM yyyy HH:mm", { in: tz(timeZone) })
    : PLACEHOLDER;
}

/**
 * `"2 h ago"` — feeds only (announcements, project updates).
 *
 * Compact by design: these sit under a title in a list, where "about 2 hours
 * ago" wraps. Anything older than a week becomes the absolute date, because
 * "43 d ago" is not something a person can place in their week.
 *
 * `now` is a parameter so this is testable without freezing the clock.
 */
export function formatRelative(
  value: DateInput,
  timeZone: string,
  now: DateInput = new Date(),
): string {
  const date = toDate(value);
  const reference = toDate(now);
  if (!date || !reference) return PLACEHOLDER;

  const minutes = differenceInMinutes(reference, date);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} m ago`;

  const hours = differenceInHours(reference, date);
  if (hours < 24) return `${hours} h ago`;

  // Calendar days in the business timezone, so "yesterday evening" is 1 d ago
  // for the shop rather than for whoever is reading it.
  const days = differenceInCalendarDays(reference, date, { in: tz(timeZone) });
  if (days < 7) return `${days} d ago`;

  return formatDate(date, timeZone);
}
