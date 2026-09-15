import { tz } from "@date-fns/tz";
import { format, subDays } from "date-fns";
import type {
  DigestPeriod,
  DigestPeriodPreset,
} from "@/features/insights/types";

/**
 * Naming the window a digest covers.
 *
 * Everything about `to` being exclusive is handled **here and nowhere else**.
 * The API's `to` is the instant one calendar day after the last day included —
 * a digest of 08–14 September carries local midnight opening the 15th — so a
 * component that prints `period.to` is off by one on every range on the page,
 * every time, and the number it prints is a plausible date. One function, one
 * subtraction, one test.
 */

/** How each preset reads in the shop's own words, on the segmented control. */
export const DIGEST_PERIOD_LABELS: Record<DigestPeriodPreset, string> = {
  today: "Today",
  last7: "Last 7 days",
  last30: "Last 30 days",
  last90: "Last 90 days",
  year: "This year",
  custom: "Custom",
};

/** The same six, short enough for a 390px header. */
export const DIGEST_PERIOD_SHORT_LABELS: Record<DigestPeriodPreset, string> = {
  today: "Today",
  last7: "7 days",
  last30: "30 days",
  last90: "90 days",
  year: "This year",
  custom: "Custom",
};

/**
 * The same six as they read **inside a sentence** — "for the last 7 days", not
 * "for Last 7 days".
 *
 * Mirrors `DIGEST_PERIOD_LABELS` in `Backend/src/lib/digest-period.ts`, which
 * is the wording the analysts themselves are given for the window they are
 * reading. The screen and the model describing the same window in the same
 * words is worth the duplicated six lines.
 */
export const DIGEST_PERIOD_SENTENCE: Record<DigestPeriodPreset, string> = {
  today: "today",
  last7: "the last 7 days",
  last30: "the last 30 days",
  last90: "the last 90 days",
  year: "this year so far",
  custom: "a chosen date range",
};

/**
 * The last day the window actually covers.
 *
 * `to` is exclusive, so this is `to − 1 day`, taken in the shop's timezone
 * rather than the reader's: the boundary is a local midnight, and subtracting a
 * day from it in a browser set to another zone can land on the wrong calendar
 * date. Exported so a test can name the subtraction directly.
 */
export function inclusiveEnd(period: DigestPeriod, timeZone: string): Date {
  return subDays(new Date(period.to), 1, { in: tz(timeZone) });
}

/**
 * `"Last 7 days · 08 – 14 Sep 2026"`, or `"Today · Monday, 14 Sep 2026"`.
 *
 * `today` gets the weekday, because an owner reading at 21:00 places "Monday"
 * faster than a date; the ranges do not, because "Tuesday 08 – Monday 14" is
 * noise. A single-day custom range collapses to one date rather than printing
 * "14 – 14 Sep 2026".
 *
 * Returns `null` for a digest with no `period` — every row written before
 * 2026-09-15. The API omits the key rather than back-filling `today`, and so
 * does this: the caller falls back to `localDate`, which is a fact, instead of
 * a window nobody recorded.
 */
export function formatDigestPeriod(
  period: DigestPeriod | undefined,
  timeZone: string,
): string | null {
  if (!period) return null;

  const label = DIGEST_PERIOD_LABELS[period.preset] ?? period.preset;
  const start = new Date(period.from);
  const end = inclusiveEnd(period, timeZone);
  const zone = { in: tz(timeZone) };

  if (period.preset === "today") {
    return `${label} · ${format(end, "EEEE, dd MMM yyyy", zone)}`;
  }

  const sameDay =
    format(start, "yyyy-MM-dd", zone) === format(end, "yyyy-MM-dd", zone);
  if (sameDay) return `${label} · ${format(end, "dd MMM yyyy", zone)}`;

  // "08 – 14 Sep 2026" when both ends share a month, as the canvas draws it;
  // "28 Aug – 14 Sep 2026" across months; the year repeated only across years.
  const sameMonth =
    format(start, "yyyy-MM", zone) === format(end, "yyyy-MM", zone);
  const sameYear = format(start, "yyyy", zone) === format(end, "yyyy", zone);
  const startFormat = sameMonth ? "dd" : sameYear ? "dd MMM" : "dd MMM yyyy";
  return `${label} · ${format(start, startFormat, zone)} – ${format(end, "dd MMM yyyy", zone)}`;
}

/**
 * What a custom range's two `<input type="date">` fields should be pre-filled
 * with: the last seven days ending today, as bare `yyyy-MM-dd`.
 *
 * Bare calendar dates, because that is what `POST /digests/run` takes
 * (`calendarDateSchema`) and what the shop's own day is expressed in. `now` is
 * a parameter so this is testable without freezing the clock.
 */
export function defaultCustomRange(
  timeZone: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const zone = { in: tz(timeZone) };
  return {
    from: format(subDays(now, 6, zone), "yyyy-MM-dd", zone),
    to: format(now, "yyyy-MM-dd", zone),
  };
}
