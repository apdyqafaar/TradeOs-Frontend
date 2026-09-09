import { apiGet, apiGetList, apiPost } from "@/lib/api/client";
import type { ObjectId, Paginated } from "@/lib/api/types";
import type {
  CreateDebtInput,
  RecordPaymentInput,
  VoidPaymentInput,
  WriteOffDebtInput,
} from "../schemas/debt.schema";
import type {
  Debt,
  DebtListParams,
  Payment,
  PaymentListParams,
} from "../types";

/**
 * The only file in this slice that knows a URL exists.
 *
 * No React, no hooks, no query client, no toasts. It does no envelope handling
 * either: the response interceptor in `lib/api/client` has already unwrapped
 * `{ success, message, data, meta }` and turned every failure into an
 * `ApiError`, so what these functions return is the domain object.
 *
 * All seven `/debts` and `/payments` rows in `docs/API-ROUTES.md` are wrapped
 * here and nothing else is. **No organization id is sent** — `requireMember`
 * resolves the tenant from the caller's own session on every request, and a
 * debt belonging to another business is a 404 rather than a 403 so an id cannot
 * be probed (`debt.actions.ts:45-49`).
 *
 * One structural note that catches people: **six of the seven endpoints hang off
 * `/debts`, and the seventh does not.** Voiding a payment is
 * `POST /payments/:id/void`, mounted on its own router, and it takes a *payment*
 * id (`payment.route.ts:15-22`). There is no `DELETE` anywhere in this slice: a
 * debt is closed by writing it off and a payment is undone by voiding it, both
 * of which are `POST`s that leave the row in place with an audit trail on it.
 */

const BASE = "/debts";

/** The void route's own mount. Not reachable under `/debts/:id/payments/...`. */
const PAYMENTS_BASE = "/payments";

/**
 * `GET /debts` — `debts:view`. Paginated, so `apiGetList`.
 *
 * `{ params }`, not `params`: the second argument is an axios *config*, and
 * passing the filter object directly would hand axios a config full of keys it
 * does not recognise and send no query string at all — a list that silently
 * ignores every filter and stays on page 1. (The scaffolder's
 * `service.ts.template` writes `apiGetList(BASE, params)`; it is wrong, and it
 * has already been written wrong here once.)
 *
 * Note what omitting `status` means: the backend defaults it to `"open"`
 * (`debt.validation.ts:18`), so this is the open-debts list unless the caller
 * says otherwise. Pass `status: "all"` for everything, `"overdue"` for the
 * server-computed overdue subset.
 */
export const list = (params: DebtListParams): Promise<Paginated<Debt>> =>
  apiGetList<Debt>(BASE, { params });

/**
 * `GET /debts/:id` — `debts:view`.
 *
 * Answers a flat `Debt` — no payments, no customer, no totals attached. A detail
 * screen needs `listPayments` as a second query, and the customer's name from
 * `features/customers`, because nothing on this response is populated.
 */
export const getById = (id: ObjectId): Promise<Debt> =>
  apiGet<Debt>(`${BASE}/${id}`);

/**
 * `POST /debts` — `debts:create`. 201 with the created debt.
 *
 * Creates a **manual** debt only; a credit sale raises its own debt elsewhere.
 * Two service-layer refusals beyond the schema, neither of which is a field the
 * form can pre-check: 409 `CUSTOMER_ARCHIVED` when the customer is not
 * `status: "active"` (`debt.service.ts:48-50`), and 422 `VALIDATION_ERROR` on
 * `dueDate` when the date is before today in the business timezone
 * (`debt.service.ts:55-59`) — see `dueDateFromCalendarDate`.
 */
export const create = (input: CreateDebtInput): Promise<Debt> =>
  apiPost<Debt>(BASE, input);

/**
 * `GET /debts/:id/payments` — `debts:view`. Newest first
 * (`payment.actions.ts:74-77`).
 *
 * 404s when the debt does not exist or belongs to another business — the
 * service loads the debt before listing (`payment.service.ts:130-131`), so this
 * is not a silently empty page.
 *
 * **Voided payments are always included** and cannot be filtered out on the
 * wire; `PaymentListParams` documents why.
 */
export const listPayments = (
  debtId: ObjectId,
  params: PaymentListParams,
): Promise<Paginated<Payment>> =>
  apiGetList<Payment>(`${BASE}/${debtId}/payments`, { params });

/**
 * `POST /debts/:id/payments` — `payments:create`. 201 with the **payment**, not
 * the updated debt.
 *
 * That return type is the reason `useRecordPayment` invalidates the debt rather
 * than seeding it: the new `paid`/`remaining`/`status` are not in this response
 * and the only honest way to learn them is to ask again.
 *
 * The failures worth knowing here, all branched on `code` and never on message:
 *
 *   - 422 `VALIDATION_ERROR` on `currency` — not the organization's main or
 *     exchange currency. Raised by `resolveRate` **before the debt is even
 *     loaded** (`payment.service.ts:34-37`), so it says nothing about whether
 *     the debt exists.
 *   - 404 `NOT_FOUND` — the debt, *or* the organization's currency
 *     configuration (`debt.service.ts:29-30`). Same code, two causes.
 *   - 409 `DEBT_NOT_OPEN` — the debt was settled, written off or cancelled since
 *     the screen loaded.
 *   - 422 or 409 `PAYMENT_EXCEEDS_BALANCE` — see `remainingFromPaymentError`.
 *
 * And one silent success: an overshoot of a cent or less is **clamped** to the
 * remaining balance rather than refused (`payment.service.ts:41-53`), so the
 * `amount` that comes back can be smaller than the one sent. Render the
 * response, not the request.
 */
export const recordPayment = (
  debtId: ObjectId,
  input: RecordPaymentInput,
): Promise<Payment> => apiPost<Payment>(`${BASE}/${debtId}/payments`, input);

/**
 * `POST /debts/:id/write-off` — `debts:write_off`. 200 with the updated debt.
 *
 * Only legal from `status: "open"` with `remaining > 0`; anything else is 409
 * `DEBT_NOT_OPEN` (`debt.service.ts:94-99`) — including a fully paid debt, whose
 * `remaining` is already 0. Irreversible in this phase.
 */
export const writeOff = (
  debtId: ObjectId,
  input: WriteOffDebtInput,
): Promise<Debt> => apiPost<Debt>(`${BASE}/${debtId}/write-off`, input);

/**
 * `POST /payments/:id/void` — `payments:void`. 200 with the voided **payment**.
 *
 * Takes the payment's own id, not the debt's. It reverses the payment's effect
 * on the debt in the same transaction: `paid` down, `remaining` up, and `status`
 * forced to `"open"` unconditionally — which reopens a settled debt, and is a
 * no-op on one that was already open (`debt.actions.ts:71-81`).
 *
 * Refused with 409 `DEBT_WRITTEN_OFF` when the debt has since been written off.
 * Worth knowing precisely: that check happens *after* the void has been applied
 * inside the transaction, so the rollback leaves the payment `"completed"` —
 * nothing partial is committed, and a retry will fail the same way until the
 * debt changes (`payment.service.ts:105-119`). 409 `PAYMENT_ALREADY_VOIDED` when
 * it was voided already.
 */
export const voidPayment = (
  paymentId: ObjectId,
  input: VoidPaymentInput,
): Promise<Payment> =>
  apiPost<Payment>(`${PAYMENTS_BASE}/${paymentId}/void`, input);
