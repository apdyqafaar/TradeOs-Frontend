/**
 * The client-side half of `GET /debts`'s amount filter.
 *
 * The server takes `minAmount` and `maxAmount` as money — two decimal places,
 * not negative — and refuses `minAmount > maxAmount` with a 422 rather than
 * returning nothing, because an impossible range is a typo and an empty table
 * hides it.
 *
 * Every one of those refusals is knowable before a request is made, which is
 * the same argument `lib/period.ts` makes for the date range: posting a
 * request whose answer is already known is a spinner followed by a red card.
 * So the range is checked here too, and the request is simply not sent while
 * it is wrong.
 *
 * **The filter applies to `remaining`** — what the customer still owes, which
 * is what a shopkeeper means by "debts between 500 and 2000". Not `principal`,
 * which is what the debt started at and is frequently not what is left.
 */

/** What is wrong with the range, or `null` when it is usable. */
export type AmountRangeIssue =
  | "invalid"
  | "negative"
  | "too-precise"
  | "reversed";

export const AMOUNT_RANGE_MESSAGES: Record<AmountRangeIssue, string> = {
  invalid: "Enter amounts as numbers.",
  negative: "An amount cannot be negative.",
  "too-precise": "Amounts go to two decimal places.",
  reversed: "The smallest amount has to be below the largest.",
};

/**
 * A typed amount to a number, or `null` when it is not one.
 *
 * `Number()` and not `parseFloat`: `parseFloat("12abc")` is `12`, which would
 * silently filter on a number the person did not type. `Number("12abc")` is
 * `NaN`, which is the honest answer. An empty string is `null` rather than
 * `Number("")`'s `0` — the difference between "no filter" and "exactly zero",
 * and the second is a real thing to ask for (a paid-off debt).
 */
export function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True when the value has more than two decimal places. */
const tooPrecise = (value: number): boolean =>
  Math.abs(Math.round(value * 100) - value * 100) > 1e-9;

/**
 * What is wrong with a min/max pair, or `null` when it can be sent.
 *
 * Both empty is `null` — no filter is not an error. One empty and one filled
 * is a half-open range and is perfectly sendable; the server takes either key
 * on its own.
 */
export function amountRangeIssue(
  min: string,
  max: string,
): AmountRangeIssue | null {
  const rawMin = min.trim();
  const rawMax = max.trim();

  const parsedMin = parseAmount(rawMin);
  const parsedMax = parseAmount(rawMax);

  // Typed something that is not a number at all.
  if (
    (rawMin !== "" && parsedMin === null) ||
    (rawMax !== "" && parsedMax === null)
  ) {
    return "invalid";
  }

  if (
    (parsedMin !== null && parsedMin < 0) ||
    (parsedMax !== null && parsedMax < 0)
  ) {
    return "negative";
  }

  if (
    (parsedMin !== null && tooPrecise(parsedMin)) ||
    (parsedMax !== null && tooPrecise(parsedMax))
  ) {
    return "too-precise";
  }

  // Only comparable when both ends are present.
  if (parsedMin !== null && parsedMax !== null && parsedMin > parsedMax) {
    return "reversed";
  }

  return null;
}
