import { API_ERROR_CODE } from "@/lib/api/errors";

/**
 * The `from`/`to` period contract, in one place.
 *
 * Ten endpoints across four features take the same three query params —
 * `period`, `from`, `to` — and are all served by the same
 * `Backend/src/lib/period.ts:resolvePeriod`. The rules below are that
 * function's, verified `file:line` in `docs/contracts/reports.md` §1.4 and
 * `docs/contracts/sales.md` §1, and they are the kind that are individually
 * plausible and collectively impossible to remember:
 *
 *   - `to` is **inclusive**, so the caller sends the last day it wants to see;
 *   - the span may be at most 366 **inclusive** days;
 *   - breaking either rule is a **400** with a code that is not a
 *     `VALIDATION_ERROR`.
 *
 * Lived in `features/sales/components/sale-filters.tsx` until the reports
 * slice needed the identical guard on six more screens; that file now
 * re-exports these so its own callers are unchanged.
 */

/**
 * The longest range the API will accept, in **inclusive calendar days**.
 *
 * `MAX_PERIOD_DAYS` is 366 in `Backend/src/lib/period.ts:33` and the guard
 * there is `differenceInCalendarDays(to, from) + 1 > 366` — so a range of
 * exactly 366 days passes and 367 fails. It makes a "last 2 years" range
 * impossible and is documented nowhere on the wire.
 */
export const MAX_PERIOD_DAYS = 366;

/**
 * The three `code`s a period-taking endpoint can answer **400** with.
 *
 * Aliases of the `API_ERROR_CODE` members rather than a second copy of the
 * strings: they were added to that table by the reports slice, and two
 * literals that must stay equal are one literal too many.
 */
export const PERIOD_ERROR_CODE = Object.freeze({
  /** `from` after `to`, or only one of the pair given (`period.ts:79,84`). */
  INVALID_PERIOD: API_ERROR_CODE.INVALID_PERIOD,
  /** More than `MAX_PERIOD_DAYS` between them (`period.ts:86-88`). */
  PERIOD_TOO_LONG: API_ERROR_CODE.PERIOD_TOO_LONG,
  /** Shaped like a date but not one — `2026-02-31` (`period.ts:51,58`). */
  INVALID_DATE: API_ERROR_CODE.INVALID_DATE,
} as const);

const PERIOD_ERROR_CODES: readonly string[] = Object.values(PERIOD_ERROR_CODE);

/**
 * True for the three 400s above, so a screen can point at the control that
 * caused one instead of showing a generic "couldn't load this".
 *
 * Structural, not `ApiError`, so React Query's un-narrowed `error` can be
 * handed over without a cast — the same reason `ErrorCardError` is.
 */
export const isPeriodError = (error: {
  status?: number;
  code?: string;
}): boolean =>
  error.status === 400 && PERIOD_ERROR_CODES.includes(error.code ?? "");

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` to a whole number of days since the epoch, or `null` when it
 * is not a real calendar date.
 *
 * Built through `Date.UTC` and compared back field by field, because the
 * round trip is what catches `2026-02-31` — `new Date("2026-02-31")` is
 * `Invalid Date` in some engines and March 3rd in others, and the server
 * answers 400 `INVALID_DATE` for it either way. Working in UTC days rather
 * than through `date-fns` keeps the span arithmetic free of the reader's
 * timezone and of any DST boundary between the two dates.
 */
export function toEpochDay(value: string): number | null {
  if (!CALENDAR_DATE.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return Math.round(utc / 86_400_000);
}

/** What is wrong with a custom range, or `null` when it is usable. */
export type RangeIssue = "incomplete" | "invalid" | "reversed" | "too-long";

/**
 * The client-side half of the server's three 400s.
 *
 * Checked here as well as there because every one of them is knowable before
 * a request: a half-filled range exists for as long as it takes to click
 * twice, and a range someone widened to two years is a 400 the moment they
 * stop typing. Posting a request whose answer is already known is a spinner
 * followed by a red card.
 *
 * **`from` and `to` are both inclusive calendar dates.** `resolvePeriod`
 * advances `to` by a day itself before the `$lt`
 * (`Backend/src/lib/period.ts:89-93`), so the span below counts both ends —
 * and a client that "compensated" by sending `to + 1` would over-select by a
 * whole day, putting the 1st of next month inside "this month".
 */
export function rangeIssue(from: string, to: string): RangeIssue | null {
  if (from === "" || to === "") return "incomplete";

  const start = toEpochDay(from);
  const end = toEpochDay(to);
  if (start === null || end === null) return "invalid";

  if (start > end) return "reversed";
  if (end - start + 1 > MAX_PERIOD_DAYS) return "too-long";

  return null;
}

/** One sentence per `RangeIssue`, for the caption under a range picker. */
export const RANGE_MESSAGES: Record<RangeIssue, string> = {
  incomplete: "Pick both dates — a range needs a start and an end.",
  invalid: "That is not a date on the calendar.",
  reversed: "The start date has to be on or before the end date.",
  "too-long": `A range can cover at most ${MAX_PERIOD_DAYS} days.`,
};
