import { TZDate } from "@date-fns/tz";
import { z } from "zod";
import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";

/**
 * MIRROR OF `../Backend/src/validators/debt.validation.ts` and
 * `../Backend/src/validators/payment.validation.ts`.
 *
 * Every bound below is copied from those two files, cross-checked against the
 * verified contract in `docs/contracts/debts.md`. This schema is not the
 * authority — the API validates again and answers a 422 whose `errors` map
 * `fieldErrorsFor` feeds into `setError`. When a backend validator changes,
 * change this file in the same commit.
 *
 * `strictObject`, matching every one of these bodies being `.strict()`: an
 * unknown key is a 422 there, so it is a parse failure here rather than a
 * silently dropped field.
 */

/** Every id in this API is a MongoDB ObjectId — 24 hex characters. */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Not a valid id");

/**
 * `MAX_MONEY` from `../Backend/src/lib/money.ts:12`. Mirrored rather than
 * approximated: a value the browser accepts and the API rejects is the one
 * failure this file exists to prevent.
 */
const MAX_MONEY = 1e12;

/**
 * `isMoney`, transcribed (`../Backend/src/lib/money.ts:34-39`). The decimal test
 * is `|n * 100 - round(n * 100)| < 1e-6` rather than a `multipleOf`, because
 * binary floats make the modulo test reject honest values (`8.29 % 0.01` is not
 * 0). Refuse rather than round: rounding hides the bug that produced the extra
 * digits, and the server refuses it anyway.
 */
const isMoney = (value: number): boolean =>
  Number.isFinite(value) &&
  value >= 0 &&
  value <= MAX_MONEY &&
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

/**
 * A strictly positive money field — both amount fields in this slice carry the
 * backend's `.refine((n) => n > 0)` on top of `moneySchema`
 * (`debt.validation.ts:7`, `payment.validation.ts:6`), so a zero is a 422.
 *
 * The `error` on `z.number()` itself is load-bearing: an empty
 * `<input type="number">` registered with `valueAsNumber` yields `NaN`, and Zod
 * fails the base type check before any refinement runs — without it the user
 * reads "expected number, received NaN".
 */
const positiveMoney = (label: string) =>
  z
    .number({ error: `${label} is required` })
    .refine(
      isMoney,
      `${label} must be a positive amount with at most 2 decimals`,
    )
    .refine((value) => value > 0, `${label} must be greater than 0`);

/**
 * `reasonSchema` (`../Backend/src/validators/common.validation.ts:43`) —
 * required and non-empty, so neither of the two destructive actions in this
 * slice can be taken without one being typed.
 *
 * Taken as a factory so each screen carries its own wording: write-off and void
 * share one backend shape but are different questions to a person, and a shared
 * "Reason is required" would be the wrong sentence on one of them.
 */
const reason = (message: string) =>
  z.string().trim().min(1, message).max(500, "That reason is too long");

/**
 * `POST /debts` — `debts:create`.
 *
 * `description` is required here even though the model makes it conditional on
 * `source === "manual"` (`debt.model.ts:47-51`): the manual-create validator
 * requires it unconditionally at the HTTP layer (`debt.validation.ts:9`), and
 * this endpoint only ever creates manual debts.
 *
 * Not here, and must not be: `status`, `paid`, `remaining`, `principal`. All
 * are server-set, the body is `.strict()`, and `principal` is stored as
 * `round2(amount)` from the `amount` field below (`debt.service.ts:65`).
 */
export const createDebtSchema = z.strictObject({
  customerId: objectId,
  amount: positiveMoney("Amount"),
  /**
   * A **full ISO 8601 instant with a `Z`**, not a calendar date and not an
   * offset form.
   *
   * The backend is `z.string().datetime()` (`debt.validation.ts:8`), whose zod 4
   * default rejects both `"2026-09-30"` and `"2026-09-30T00:00:00+03:00"` —
   * verified against this repo's zod 4.5.4 and the backend's 4.4.3. That second
   * rejection is the trap: `new TZDate(...).toISOString()` produces the offset
   * form and would 422. Build this with `dueDateFromCalendarDate` below.
   *
   * A second rule this cannot express: the server also refuses a `dueDate`
   * before the start of *today in the business timezone*
   * (`debt.service.ts:55-59`), which arrives as a 422 on this field. Nothing
   * client-side knows that boundary without the timezone, so the check stays on
   * the server and the field error is rendered where the API puts it.
   */
  dueDate: z.iso.datetime({
    error: "Pick a due date",
  }),
  description: z
    .string()
    .trim()
    .min(1, "Say what this debt is for")
    .max(500, "That description is too long"),
});

/**
 * `POST /debts/:id/payments` — `payments:create`.
 *
 * There is **no `exchangeRate` field**, and adding one is a 422: the server
 * resolves the rate itself from the organization's `CurrencyConfig` at the
 * instant of the write and freezes it onto the record (`resolveRate`,
 * `debt.service.ts:25-38`). A form that shows a conversion preview must read
 * the rate from `useCurrencyConfig()` for display only — the number that ends
 * up on the payment is the server's.
 */
export const recordPaymentSchema = z.strictObject({
  amount: positiveMoney("Payment amount"),
  /**
   * Uppercased here because the backend uppercases before checking the length
   * (`payment.validation.ts:7`), so the value this form holds is the value the
   * API stores.
   *
   * Three letters is all this can check. The server additionally requires it to
   * be the organization's **main or exchange** currency and answers 422
   * `VALIDATION_ERROR` on this field otherwise, naming both acceptable codes in
   * the message (`debt.service.ts:32-37`). So offer a choice of the two from
   * `useCurrencyConfig()` rather than a free-text box — and never default it to
   * a hardcoded code.
   */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, "Use a 3-letter currency code"),
  /**
   * Blank collapses to absent. The API would accept `""` (the backend has no
   * `min`), but storing an empty note is noise on a record that is read back in
   * disputes, and `JSON.stringify` drops an `undefined` so the request omits the
   * key entirely — which is what "no note" means to the API.
   */
  note: z
    .string()
    .trim()
    .max(500, "That note is too long")
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
});

/**
 * `POST /debts/:id/write-off` — `debts:write_off`.
 *
 * The body is only a reason. **No amount**: `writeOffDebtById` sets
 * `writtenOffAmount` from the live `$remaining` inside an aggregation-pipeline
 * update (`debt.actions.ts:126-141`), so the figure written off is whatever is
 * owed at that instant on the server, not anything this form can propose. A UI
 * that shows the amount about to be written off is showing `debt.remaining` as
 * of its last fetch, and should say so.
 *
 * Irreversible in this phase — there is no un-write-off endpoint
 * (`debt.service.ts:86-88`).
 */
export const writeOffDebtSchema = z.strictObject({
  reason: reason("Say why this debt is being written off"),
});

/**
 * `POST /payments/:id/void` — `payments:void`. Same body shape as the write-off,
 * a different question, and a **payment** id in the path, not a debt id
 * (`payment.route.ts:15-22`).
 */
export const voidPaymentSchema = z.strictObject({
  reason: reason("Say why this payment is being voided"),
});

export type CreateDebtInput = z.infer<typeof createDebtSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type WriteOffDebtInput = z.infer<typeof writeOffDebtSchema>;
export type VoidPaymentInput = z.infer<typeof voidPaymentSchema>;

/**
 * Turns the `YYYY-MM-DD` a native date input produces into the instant
 * `createDebtSchema.dueDate` accepts.
 *
 * Three separate things go wrong without this, and two of them are invisible in
 * East Africa, which is where this will be tested:
 *
 *   1. **A bare `"2026-09-30"` is a 422.** `z.string().datetime()` wants a full
 *      instant.
 *   2. **Midnight UTC can be yesterday.** The server compares against
 *      `startOfDayIn(organization.timezone, now)` (`debt.service.ts:56-59`), so
 *      the obvious `new Date(picked).toISOString()` — which is midnight UTC —
 *      is *before* the start of today for every business west of Greenwich. A
 *      shop in New York picking today would be told the due date is in the past.
 *   3. **`TZDate.prototype.toISOString()` emits an offset**, e.g.
 *      `2026-09-30T12:00:00.000+03:00`, which `z.string().datetime()` rejects
 *      outright. Hence the round trip through a plain `Date`, which always
 *      serialises with a `Z`.
 *
 * Noon in the business's own timezone: unambiguous across every DST transition
 * (a midnight can simply not exist on a spring-forward date), on the calendar
 * day the person actually picked, and comfortably after the start of that day
 * whichever zone the shop keeps.
 *
 * `timeZone` is required and comes from `useOrganization().timezone` — the same
 * zone `formatDate` renders in, so what the form shows and what the server
 * stores describe the same day. An IANA zone Intl cannot resolve throws a
 * `RangeError` here rather than silently shifting the date; `useOrganization`
 * only ever yields a real zone, falling back to `"UTC"`.
 */
export function dueDateFromCalendarDate(
  calendarDate: string,
  timeZone: string,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(calendarDate);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${calendarDate}`);

  const [, year, month, day] = match;
  const noonLocal = new TZDate(
    Number(year),
    Number(month) - 1,
    Number(day),
    12,
    0,
    0,
    0,
    timeZone,
  );
  return new Date(noonLocal.getTime()).toISOString();
}

/**
 * The 409 the payment form raises against a field, and which field.
 *
 * Feeds the `CONFLICT_FIELDS` slot in the form template. A payment larger than
 * the balance is not a banner: the caller typed a number the debt cannot absorb,
 * and the only thing they can do about it is change that box.
 *
 * `DEBT_NOT_OPEN` is deliberately absent from every map here. It is refused at
 * the level of the whole action — the debt was settled, written off or cancelled
 * out from under the screen — so it belongs inline on the control that was
 * pressed, next to a "refresh" affordance, and there is no field to fix.
 */
export const PAYMENT_CONFLICT_FIELDS = {
  [API_ERROR_CODE.PAYMENT_EXCEEDS_BALANCE]: "amount",
} as const satisfies Partial<Record<string, keyof RecordPaymentInput>>;

/**
 * The server's authoritative `remaining` off a failed payment — when it sent
 * one.
 *
 * `PAYMENT_EXCEEDS_BALANCE` is **one code with two shapes**, and a caller that
 * assumes the first will render `undefined` on a screen about money:
 *
 *   - **422**, from the pre-transaction check: `details: { remaining }` is set,
 *     and `errors: { amount }` too, so `fieldErrorsFor` already puts a message
 *     on the box (`payment.service.ts:46-51`).
 *   - **409**, when a concurrent payment won the guarded update inside the
 *     transaction: the balance moved while this request was in flight, so the
 *     server does not claim to know what it is now and sends **no `details` and
 *     no field errors** (`payment.service.ts:59-68`).
 *
 * So this returns a number only in the first case. On `undefined`, the honest
 * message is "someone else recorded a payment on this debt just now" plus a
 * refetch — not a stale balance dressed up as the current one.
 */
export function remainingFromPaymentError(error: unknown): number | undefined {
  if (!isApiError(error)) return undefined;
  if (error.code !== API_ERROR_CODE.PAYMENT_EXCEEDS_BALANCE) return undefined;

  const remaining = error.details?.remaining;
  return typeof remaining === "number" ? remaining : undefined;
}
