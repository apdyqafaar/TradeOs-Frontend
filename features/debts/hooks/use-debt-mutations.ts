"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { customerKeys } from "@/features/customers/keys";
import { dashboardKeys } from "@/features/dashboard/keys";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { debtKeys } from "../keys";
import type {
  CreateDebtInput,
  RecordPaymentInput,
  VoidPaymentInput,
  WriteOffDebtInput,
} from "../schemas/debt.schema";
import * as debtService from "../services/debt.service";
import type { Debt, Payment } from "../types";

/**
 * The four writes in this slice, and the cache work each one owes.
 *
 * **This file is mostly about invalidation, and that is on purpose.** Every
 * mutation here moves a balance, and a balance is rendered in four places that
 * do not know about each other:
 *
 *   1. `debtKeys.detail(debtId)` — the debt's own `paid` / `remaining` /
 *      `status`, and the server-computed `isOverdue` / `daysOverdue` that follow
 *      from them.
 *   2. `debtKeys.lists()` — `remaining` is a column *and* a filter input, and
 *      `status` decides which page a row lives on. A settled debt leaves the
 *      default `status=open` list entirely; a written-off one joins
 *      `status=written_off`; a voided payment can pull a debt back from `paid`
 *      into `open`. `meta.total` moves on each, so no cached page can be
 *      patched.
 *   3. `debtKeys.payments(debtId)` — the repayment history, when a row was added
 *      or one of its rows changed status.
 *   4. `customerKeys.detail(customerId)` — the debt summary
 *      `features/customers` already renders. `{ open, overdue, totalRemaining }`
 *      is a server-side aggregate over this customer's open debts
 *      (`../Backend/src/db/actions/debt.actions.ts:197-221`), so every one of
 *      these mutations moves it and none of them returns it. **This is the
 *      cross-feature edge that is easy to miss**: nothing in `features/customers`
 *      can know a payment happened, so the write that caused it has to say so.
 *
 * Plus `dashboardKeys.all`, whose Overview carries `outstanding`,
 * `overdueAmount`, `overdueCount` and a top-ten overdue table — its own keys
 * file names "after a sale or a payment" as the reason that prefix exists.
 *
 * `customerKeys.lists()` is deliberately **not** invalidated by any of them:
 * `publicCustomer` is nine fields with no debt figures among them
 * (`../Backend/src/controller/customer.controller.ts:13-23`), so a customer list
 * row cannot go stale from a debt moving.
 *
 * None of these is optimistic, and that is a decision. Each one can be refused
 * by a rule only the server can evaluate — `CUSTOMER_ARCHIVED`, `DEBT_NOT_OPEN`,
 * `PAYMENT_EXCEEDS_BALANCE`, `DEBT_WRITTEN_OFF`, `PAYMENT_ALREADY_VOIDED` — and
 * the server clamps a sub-cent overshoot rather than taking the amount as sent.
 * A balance that appears, then rolls back, is worse than a spinner on a screen
 * whose whole subject is what someone owes.
 *
 * Nothing here renders an error. A 409 belongs at the control the user pressed
 * (`PAYMENT_CONFLICT_FIELDS` maps the one that has a field to blame), and a toast
 * fired from `onError` here would consume it first.
 */

/** The arguments a payment needs. The hook takes none, so the debt id rides along. */
export interface RecordPaymentVariables {
  debtId: ObjectId;
  input: RecordPaymentInput;
}

/** The arguments a write-off needs. */
export interface WriteOffDebtVariables {
  debtId: ObjectId;
  input: WriteOffDebtInput;
}

/** A **payment** id, not a debt id — the route is `POST /payments/:id/void`. */
export interface VoidPaymentVariables {
  paymentId: ObjectId;
  input: VoidPaymentInput;
}

/**
 * `POST /debts` — a hand-entered debt.
 *
 * Invalidates `debtKeys.lists()` (a new row, and `meta.total` with it) and
 * `customerKeys.detail(customerId)` (the customer's `open` count and
 * `totalRemaining` both just grew), and refreshes the dashboard's outstanding
 * figures.
 *
 * The detail cache **is** seeded from this response, unlike
 * `useCreateCustomer`, and the difference is worth knowing: a customer's detail
 * key holds a `CustomerDetail` — a richer shape than a create returns — whereas
 * `debtKeys.detail(id)` holds exactly a `Debt`, and `publicDebt` is the same
 * shaper behind both `POST /debts` and `GET /debts/:id`
 * (`debt.controller.ts:52-56, 71-77`). Nothing is invented by writing it.
 *
 * The mutation's data is the created `Debt`, so a caller's `mutate(input, {
 * onSuccess: (debt) => … })` can navigate straight to it.
 *
 * Refusals a form must handle: 409 `CUSTOMER_ARCHIVED` (belongs on the customer
 * picker — the only fix is choosing someone else) and 422 `VALIDATION_ERROR` on
 * `dueDate` for a date before today in the business timezone, which arrives as a
 * field error and lands on the date box by itself.
 */
export function useCreateDebt(): UseMutationResult<
  Debt,
  ApiError,
  CreateDebtInput
> {
  const queryClient = useQueryClient();

  return useMutation<Debt, ApiError, CreateDebtInput>({
    mutationFn: debtService.create,
    onSuccess: (debt) => {
      queryClient.setQueryData<Debt>(debtKeys.detail(debt.id), debt);

      void queryClient.invalidateQueries({ queryKey: debtKeys.lists() });
      void queryClient.invalidateQueries({
        queryKey: customerKeys.detail(debt.customerId),
      });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/**
 * `POST /debts/:id/payments` — money received against a debt.
 *
 * **The response is the `Payment`, not the updated debt**, so the debt's new
 * `paid` / `remaining` / `status` are simply not in hand: the detail entry is
 * invalidated rather than seeded, because the only honest way to learn a balance
 * this write changed is to ask the server that changed it. Recomputing
 * `remaining - amountMain` locally would be wrong twice over — the server clamps
 * a sub-cent overshoot to the balance, and it forces `remaining` to exactly `0`
 * and `status` to `"paid"` once the leftover falls to 0.004 or less
 * (`debt.actions.ts:83-92`), tolerances that are never on the wire.
 *
 * Four keys, and each is a screen that would otherwise lie:
 *
 *   - `debtKeys.detail(debtId)` — the balance the user is looking at.
 *   - `debtKeys.lists()` — the row may have just left the open-debts list.
 *   - `debtKeys.payments(debtId)` — the history gained the row just created.
 *   - `customerKeys.detail(payment.customerId)` — `totalRemaining` fell, and
 *     `open` / `overdue` fall too if this settled the debt. The customer id
 *     comes off the payment itself (`publicPayment` denormalises it), so no
 *     extra fetch is needed to find whose summary moved.
 *
 * Plus the dashboard, whose outstanding and overdue totals both include this.
 *
 * **Failure handling this hook's caller must get right.**
 * `PAYMENT_EXCEEDS_BALANCE` is one code with two shapes: a **422** from the
 * pre-transaction check, carrying `details.remaining` *and* a field error on
 * `amount`; or a **409** when a concurrent payment won the guarded update, with
 * neither (`payment.service.ts:41-53, 59-68`). Read the balance with
 * `remainingFromPaymentError`, which returns `undefined` on the 409 — and on
 * `undefined` say that someone else just paid against this debt and refetch,
 * rather than printing a balance from before the race.
 *
 * 409 `DEBT_NOT_OPEN` **here** means the debt was settled, written off or
 * cancelled since this screen loaded — it does *not* mean what the same code
 * means on a write-off, and the API's message ("Debt is not open") is identical
 * in both places (`payment.service.ts:39`, `debt.service.ts:98`). Which hook
 * raised it is the only thing that distinguishes them, which is why the two live
 * in separate hooks with separate doc comments rather than behind one
 * `useDebtAction`. Say "this debt is no longer open — refresh to see where it
 * stands" and refetch the detail.
 */
export function useRecordPayment(): UseMutationResult<
  Payment,
  ApiError,
  RecordPaymentVariables
> {
  const queryClient = useQueryClient();

  return useMutation<Payment, ApiError, RecordPaymentVariables>({
    mutationFn: ({ debtId, input }) => debtService.recordPayment(debtId, input),
    onSuccess: (payment) => {
      void queryClient.invalidateQueries({
        queryKey: debtKeys.detail(payment.debtId),
      });
      void queryClient.invalidateQueries({ queryKey: debtKeys.lists() });
      void queryClient.invalidateQueries({
        queryKey: debtKeys.payments(payment.debtId),
      });
      void queryClient.invalidateQueries({
        queryKey: customerKeys.detail(payment.customerId),
      });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/**
 * `POST /debts/:id/write-off` — closing a debt as lost.
 *
 * The response is the updated `Debt`, so the detail entry is **seeded**: the
 * `writtenOffAmount`, the zeroed `remaining` and the `written_off` status update
 * on the same frame with no second request. `writtenOffAmount` is set from the
 * live `$remaining` inside an aggregation-pipeline update, so this response is
 * the only place the amount actually written off can be read — the value the
 * screen showed a moment ago was a guess if anything had moved since.
 *
 * `debtKeys.lists()` because the row leaves the open list, and
 * `customerKeys.detail(debt.customerId)` because writing off is what *clears*
 * a customer's open-debt block: `DELETE /customers/:id` refuses with 409
 * `CUSTOMER_HAS_OPEN_DEBT` while any open debt exists, and this is the write
 * that removes one. A stale summary here means an Archive button that stays
 * disabled for no visible reason.
 *
 * **`debtKeys.payments(debtId)` is deliberately not invalidated.** A write-off
 * creates no payment and voids none; the history is unchanged, and refetching it
 * would only cost a request.
 *
 * 409 `DEBT_NOT_OPEN` **here** means the debt was not `open` with `remaining > 0`
 * — which includes the fully-paid case, where there is nothing left to write off
 * (`debt.actions.ts:126-127`, `debt.service.ts:94-99`). Same code and same
 * message as the payment path, different situation: say "there is nothing left
 * to write off on this debt". Irreversible once it succeeds — there is no
 * un-write-off endpoint, so this belongs behind a confirmation.
 */
export function useWriteOffDebt(): UseMutationResult<
  Debt,
  ApiError,
  WriteOffDebtVariables
> {
  const queryClient = useQueryClient();

  return useMutation<Debt, ApiError, WriteOffDebtVariables>({
    mutationFn: ({ debtId, input }) => debtService.writeOff(debtId, input),
    onSuccess: (debt) => {
      queryClient.setQueryData<Debt>(debtKeys.detail(debt.id), debt);

      void queryClient.invalidateQueries({ queryKey: debtKeys.lists() });
      void queryClient.invalidateQueries({
        queryKey: customerKeys.detail(debt.customerId),
      });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/**
 * `POST /payments/:id/void` — undoing a payment that should not have been taken.
 *
 * Keyed by the **payment** id: this route is mounted on `/payments`, not under
 * the debt (`payment.route.ts:15-22`). The debt it belongs to comes back on the
 * response, which is what the invalidations below are addressed with — a caller
 * never has to tell this hook which debt it is touching.
 *
 * The same four keys as a payment, for the mirror-image reason: `paid` falls,
 * `remaining` rises, and the debt's `status` is forced to `"open"`
 * **unconditionally** (`debt.actions.ts:71-81`) — so a `paid` debt reappears on
 * the open list, and a debt that was already open stays there with a larger
 * balance. The payments list is invalidated because the voided row's own
 * `status`, `voidedAt` and `voidReason` all changed; it stays in the list rather
 * than leaving it, since there is no way to filter voided payments out on the
 * wire.
 *
 * Two refusals, both 409: `PAYMENT_ALREADY_VOIDED` (someone got there first — a
 * refetch of the history will show it), and `DEBT_WRITTEN_OFF`, which is the one
 * worth explaining on screen. The debt was written off after this payment was
 * taken, and reversing the payment would put money back onto a debt already
 * declared lost, so the whole transaction rolls back and the payment stays
 * `"completed"` (`payment.service.ts:105-119`). Nothing partial is committed and
 * retrying will fail identically — say so, rather than offering a retry.
 */
export function useVoidPayment(): UseMutationResult<
  Payment,
  ApiError,
  VoidPaymentVariables
> {
  const queryClient = useQueryClient();

  return useMutation<Payment, ApiError, VoidPaymentVariables>({
    mutationFn: ({ paymentId, input }) =>
      debtService.voidPayment(paymentId, input),
    onSuccess: (payment) => {
      void queryClient.invalidateQueries({
        queryKey: debtKeys.detail(payment.debtId),
      });
      void queryClient.invalidateQueries({ queryKey: debtKeys.lists() });
      void queryClient.invalidateQueries({
        queryKey: debtKeys.payments(payment.debtId),
      });
      void queryClient.invalidateQueries({
        queryKey: customerKeys.detail(payment.customerId),
      });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}
