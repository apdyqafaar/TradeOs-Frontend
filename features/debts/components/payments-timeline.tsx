"use client";

import { cn } from "cn";
import { parseAsInteger, useQueryStates } from "nuqs";
import { useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useVoidPayment } from "@/features/debts/hooks/use-debt-mutations";
import { useDebtPayments } from "@/features/debts/hooks/use-debt-payments";
import { voidPaymentSchema } from "@/features/debts/schemas/debt.schema";
import type { Debt, Payment } from "@/features/debts/types";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/format/date";
import { formatExchange, formatMoney } from "@/lib/format/money";

const PAGE_PARSERS = {
  /**
   * `payPage`, not `page`: `/debts/[id]` has no other paginated list today,
   * but two lists on one URL writing the same key would page each other, and
   * `stock-movements-table.tsx` already set the prefix-per-list precedent.
   */
  payPage: parseAsInteger.withDefault(1),
};

export interface PaymentsTimelineProps {
  debtId: ObjectId;
  /**
   * The debt's stored status, for the one thing the timeline cannot decide on
   * its own: **a payment on a written-off debt can never be voided.**
   * `voidPayment` rolls the whole transaction back with 409 `DEBT_WRITTEN_OFF`
   * (`../Backend/src/services/payment.service.ts:111-113`), so offering the
   * control would be offering a button guaranteed to fail.
   */
  debtStatus: Debt["status"];
}

/**
 * A debt's repayment history — artboard `2g`'s lower panel
 * (`docs/design/TradeOs-UI.dc.html:911-935`).
 *
 * Newest first, and **voided payments stay in the list**. There is no status
 * filter on `GET /debts/:id/payments` and its query schema is `.strict()`, so
 * `?status=completed` is a 422 rather than a narrower list; the trail is the
 * point, so a void is struck through and pilled rather than hidden. A "hide
 * voided" control is deliberately absent: it could only filter the fetched
 * page while `meta.total` kept counting the rows it dropped.
 *
 * Two things the canvas draws that the payload cannot fill:
 *
 *   1. **Who took the money.** `receivedBy` is a bare Member id — there is no
 *      `populate` anywhere in the debts/payments backend path — and there is no
 *      members slice to resolve it against. So the cell is an em dash with the
 *      id in its `title`, which is traceable without being an invented name.
 *      `stock-movements-table.tsx` reached the same place for its "Who" column;
 *      this follows it rather than inventing a second answer.
 *   2. **The frozen exchange rate.** A payment tendered in the exchange
 *      currency carries `exchangeRate`, and the canvas's second line has room
 *      only for the tendered amount. `formatExchange(...).converted` would
 *      print a *second* main-currency figure beside `amountMain` — the one the
 *      server actually moved the balance with — so the tendered amount is
 *      rendered alone.
 */
export function PaymentsTimeline({
  debtId,
  debtStatus,
}: PaymentsTimelineProps) {
  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();
  const [{ payPage }, setPaging] = useQueryStates(PAGE_PARSERS, {
    history: "replace",
    scroll: false,
  });

  const { data, error, isPending, refetch } = useDebtPayments(debtId, {
    page: payPage,
  });

  /*
   * `payments:void` is not in the Seller preset, so most people who can record
   * a payment cannot reverse one. A caller without it sees no control at all
   * rather than a disabled one — CLAUDE.md's rule.
   */
  const canVoid = useCan(PERMISSIONS.PAYMENTS_VOID);
  const writtenOff = debtStatus === "written_off";

  const payments = data?.items ?? [];
  const meta = data?.meta;

  return (
    <section className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-[10px] border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-border border-b bg-muted px-[18px] py-2.5">
          <h2 className="font-medium font-mono text-[11px] uppercase tracking-[0.08em] text-foreground">
            Payments
          </h2>
          {/* `meta.total` counts voided rows too, so the caption stays a bare
              count rather than claiming a number of payments received. */}
          <span className="font-mono text-[11px] text-muted-foreground">
            {meta ? `${meta.total} · newest first` : "newest first"}
          </span>
        </div>

        {/*
          The organization gates the rows: every amount and every timestamp
          below is rendered in its currency and timezone, and a row that
          redraws its date or loses its currency code a beat later reads as a
          bug rather than as a load.
        */}
        {isPending || organizationLoading ? (
          <div className="flex flex-col gap-3 p-[18px]">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-5 w-32" />
          </div>
        ) : payments.length === 0 ? (
          <p className="px-[18px] py-8 text-center text-[13px] text-muted-foreground">
            Nothing has been paid against this debt yet.
          </p>
        ) : (
          payments.map((payment) => (
            <PaymentRow
              key={payment.id}
              payment={payment}
              currency={currency}
              timezone={timezone}
              canVoid={canVoid && !writtenOff}
            />
          ))
        )}
      </div>

      {writtenOff && canVoid ? (
        <p className="text-[12px] text-muted-2">
          This debt has been written off, so its payments can no longer be
          reversed.
        </p>
      ) : null}

      {error ? (
        <ErrorCard
          error={error}
          title="Couldn't load the payments"
          retry={() => {
            void refetch();
          }}
        />
      ) : null}

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={meta.page <= 1}
            onClick={() => void setPaging({ payPage: meta.page - 1 })}
          >
            Previous
          </Button>
          <span className="font-mono text-[12px] text-muted-foreground">
            {meta.page} / {meta.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={meta.page >= meta.totalPages}
            onClick={() => void setPaging({ payPage: meta.page + 1 })}
          >
            Next
          </Button>
        </div>
      ) : null}
    </section>
  );
}

interface PaymentRowProps {
  payment: Payment;
  /** The organization's main currency — what `amountMain` is denominated in. */
  currency: string;
  timezone: string;
  canVoid: boolean;
}

/** One entry: what moved the balance, when, who took it, and why not. */
function PaymentRow({ payment, currency, timezone, canVoid }: PaymentRowProps) {
  const [confirming, setConfirming] = useState(false);
  const voided = payment.status === "voided";

  /*
   * `amountMain`, never `amount`. `payment.service.ts:58` passes `amountMain`
   * to the balance update, so this is the figure that actually moved the debt;
   * a timeline showing `amount` for a mixed-currency history would not
   * reconcile against `Debt.paid`.
   */
  const headline = formatMoney(payment.amountMain, currency);

  /*
   * The canvas's `tendered …` line, shown only when the money came in as
   * something other than the books' currency. `formatExchange` MULTIPLIES by
   * the rate, mirroring `toMain` in `../Backend/src/lib/money.ts` — the
   * inverse reads more naturally out loud and is how this repo once printed
   * KES 0.77 for a KES 13,000 tender.
   */
  const tendered =
    payment.currency !== currency
      ? formatExchange(
          payment.amount,
          payment.currency,
          payment.exchangeRate,
          currency,
        ).tendered
      : null;

  return (
    <div className="flex flex-col gap-1.5 border-border border-b px-[18px] py-3.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "font-medium font-mono text-[16px]",
            voided ? "text-muted-2 line-through" : "text-foreground",
          )}
        >
          {headline}
        </span>
        <span className="font-mono text-[12px] text-muted-2">
          {formatDateTime(payment.createdAt, timezone)}
        </span>
      </div>

      {tendered ? (
        <span className="font-mono text-[12px] text-muted-foreground">
          tendered {tendered}
        </span>
      ) : null}

      <div className="flex flex-wrap items-center gap-2.5">
        {/*
          `receivedBy` is a Member id and nothing in this response names them.
          An em dash with the id in `title` is traceable; a name assembled from
          anything on this page would be fiction.
        */}
        <span
          className="text-[12px] text-muted-foreground"
          title={`Received by member ${payment.receivedBy}`}
        >
          —
        </span>
        {payment.note ? (
          <span className="text-[12px] text-muted-2">· {payment.note}</span>
        ) : null}
      </div>

      {voided ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex h-[22px] items-center rounded-lg border border-border-strong px-2 font-medium text-[11px] text-muted-foreground">
            Voided
          </span>
          {payment.voidReason ? (
            <span className="text-[12px] text-muted-2">
              {payment.voidReason}
            </span>
          ) : null}
        </div>
      ) : canVoid ? (
        <VoidControl
          payment={payment}
          confirming={confirming}
          onStart={() => setConfirming(true)}
          onDone={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}

interface VoidControlProps {
  payment: Payment;
  confirming: boolean;
  onStart: () => void;
  onDone: () => void;
}

/**
 * Void, behind one confirmation that collects the reason the API requires.
 *
 * Inline rather than a third dialog: `voidSchema` is one required field, the
 * row it belongs to is the context, and — the reason that decides it — **every
 * refusal has to land beside the control that was refused**, not in a toast
 * that leaves the screen while the button that caused it stays.
 *
 * Both refusals are 409s with nothing to fix:
 *
 *   - `PAYMENT_ALREADY_VOIDED` — someone got there first; the mutation's own
 *     invalidation is already refetching the history that proves it.
 *   - `DEBT_WRITTEN_OFF` — the debt was written off after this payment was
 *     taken. The check runs *after* the void is applied inside the transaction,
 *     so the rollback undoes it, nothing partial is committed, and a retry
 *     fails identically. The copy says so rather than offering one.
 */
function VoidControl({
  payment,
  confirming,
  onStart,
  onDone,
}: VoidControlProps) {
  const voidPayment = useVoidPayment();
  const [reason, setReason] = useState("");
  const [issue, setIssue] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          // Clears a refusal from a previous attempt, so the message beside
          // the control always belongs to the attempt in front of the reader.
          voidPayment.reset();
          setReason("");
          setIssue(null);
          onStart();
        }}
        className="w-fit rounded-[6px] font-medium text-[12px] text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Void this payment
      </button>
    );
  }

  const failed = (error: ApiError) => {
    const fields = fieldErrorsFor(error);

    // Branch on `code`, never on `message` (CLAUDE.md) — both of these arrive
    // with a generic sentence that says what is true but not what to do.
    if (error.code === API_ERROR_CODE.DEBT_WRITTEN_OFF) {
      setIssue(
        "This debt has been written off, so its payments can no longer be reversed. Nothing was changed, and trying again will fail the same way.",
      );
      return;
    }
    if (error.code === API_ERROR_CODE.PAYMENT_ALREADY_VOIDED) {
      setIssue(
        "This payment was already voided — the history is refreshing to show it.",
      );
      return;
    }
    setIssue(fields.reason ?? error.message);
  };

  const submit = () => {
    const parsed = voidPaymentSchema.safeParse({ reason });
    if (!parsed.success) {
      setIssue(parsed.error.issues[0]?.message ?? "Say why.");
      return;
    }

    setIssue(null);
    voidPayment.mutate(
      { paymentId: payment.id, input: parsed.data },
      { onSuccess: onDone, onError: failed },
    );
  };

  const busy = voidPayment.isPending;

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-[10px] border border-border bg-background p-3">
      <label
        htmlFor={`void-reason-${payment.id}`}
        className="font-medium text-[12px] text-foreground"
      >
        Why is this payment being voided?
      </label>
      <input
        id={`void-reason-${payment.id}`}
        type="text"
        autoComplete="off"
        value={reason}
        disabled={busy}
        placeholder="Entered twice by mistake"
        onChange={(event) => {
          setReason(event.target.value);
          setIssue(null);
        }}
        aria-invalid={issue ? true : undefined}
        className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive"
      />

      {issue ? (
        <p role="alert" className="text-[12px] text-destructive-strong">
          {issue}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setIssue(null);
            onDone();
          }}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={submit}
        >
          {busy ? "Voiding…" : "Void payment"}
        </Button>
      </div>
    </div>
  );
}
