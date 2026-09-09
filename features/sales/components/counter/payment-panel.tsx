"use client";

import { cn } from "cn";
import { CurrencyToggle } from "@/components/shared/currency-toggle";
import { ErrorCard } from "@/components/shared/error-card";
import { MoneyInput } from "@/components/shared/money-input";
import type { Customer } from "@/features/customers/types";
import { CreditBlock } from "@/features/sales/components/counter/credit-block";
import type { CounterIssues } from "@/features/sales/components/counter/issues";
import type { TenderOutcome } from "@/features/sales/components/counter/tender";
import type { ApiError } from "@/lib/api/errors";
import { formatMoney } from "@/lib/format/money";

/** Everything the credit block owns, passed through rather than lifted flat. */
export interface CreditFields {
  customer: Customer | null;
  onCustomerChange: (customer: Customer) => void;
  /** `YYYY-MM-DD`. `counter.tsx` turns it into the instant the API wants. */
  dueDate: string;
  onDueDateChange: (calendarDate: string) => void;
  note: string;
  onNoteChange: (note: string) => void;
}

export interface PaymentPanelProps {
  /** The ISO code the customer is paying in: the main or the exchange currency. */
  currency: string;
  onCurrencyChange: (currency: string) => void;
  /** The books' currency. Every figure except the tender and the change is in it. */
  mainCurrency: string;
  /** Units of main per one unit of `currency`; `1` when they are the same. */
  rate: number;
  tendered: number | null;
  onTenderedChange: (value: number | null) => void;
  /** From `tenderOutcome(...)` — never recomputed in this file. */
  outcome: TenderOutcome;
  issues: CounterIssues;
  credit: CreditFields;
  /** Today as `YYYY-MM-DD` in the business's timezone. */
  today: string;
  canCreate: boolean;
  canPickCustomer: boolean;
  busy: boolean;
  onSubmit: () => void;
  /** A failure `serverIssues` could not route to a control: a 500, a dead network. */
  error?: ApiError | null;
}

const CAPTION = "font-medium text-[12px] text-foreground";

/**
 * The payment band of artboard `2a`: the currency toggle and its rate hint, the
 * amount tendered, what is still owed, the credit block and the 56px commit.
 *
 * **Two of these figures are in different currencies and the screen has to say
 * so.** `amountTendered` and `change` are in the tendered currency;
 * `total`, `amountPaidMain` and `amountDue` are in the business's main currency
 * (`docs/contracts/sales.md` §6, trap 5). The canvas draws both boxes holding a
 * bare number, which is honest only in its own example, where the shop tenders
 * in its main currency — so the second box carries its **code**. A `167.75`
 * beside a `100.00` that are not the same money is the receipt dispute this
 * whole convention exists to prevent.
 *
 * `MoneyInput` is deliberately given **no `max`**. Its over-max state is built
 * for the record-payment dialog, where paying more than a debt's balance is a
 * refusal; at a counter, handing over more than the bill is the normal case and
 * the answer is change, not an error.
 */
export function PaymentPanel({
  currency,
  onCurrencyChange,
  mainCurrency,
  rate,
  tendered,
  onTenderedChange,
  outcome,
  issues,
  credit,
  today,
  canCreate,
  canPickCustomer,
  busy,
  onSubmit,
  error,
}: PaymentPanelProps) {
  const owing = outcome.amountDue > 0;
  const change = !owing && outcome.change > 0;
  /*
   * The block appears when a **tender** leaves a balance, not merely when one
   * is outstanding. An untouched amount box owes the whole bill by definition,
   * and opening the debt form on the first scan of every sale would make the
   * exceptional case the default one.
   *
   * It also appears whenever the server has asked for either field, whatever
   * this screen believes. The two can genuinely disagree: an omitted
   * `unitPrice` is substituted from the product's price **at commit time**
   * (`sale.service.ts:153`), so a price edited in another tab between the scan
   * and the tap makes the server's total — and its `amountDue` — larger than
   * the one on screen. Without this the 422 it answers with would be routed to
   * two controls that are not rendered, and the sale would refuse itself
   * silently.
   */
  const showCredit =
    (owing && tendered !== null) ||
    issues.customer !== undefined ||
    issues.dueDate !== undefined;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-3.5 border-border border-t bg-background px-5 py-4"
    >
      <span className="font-medium font-mono text-[11px] text-foreground uppercase tracking-[0.08em]">
        Payment
      </span>

      {/* Renders nothing for a single-currency business, and nothing while the
          config is still loading — so nothing below may assume it is there
          (`docs/findings/slice3-money-ui.md`). */}
      <CurrencyToggle
        value={currency}
        onChange={onCurrencyChange}
        label="Tendered currency"
      />

      {issues.currency ? (
        <p className="text-[12px] text-destructive-strong">{issues.currency}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
          <MoneyInput
            label="Amount tendered"
            value={tendered}
            onChange={onTenderedChange}
            currency={currency}
            mainCurrency={mainCurrency}
            exchangeRate={rate}
            disabled={busy}
            placeholder="0.00"
            // The field's default fill is `bg-background`, which is what this
            // band is — one step off whatever it sits on is the rule, and the
            // component cannot know its surroundings, so the caller overrides
            // it (`docs/findings/slice3-money-ui.md`).
            className="[&_input]:bg-card"
          />
          {issues.tendered ? (
            <p className="text-[12px] text-destructive-strong">
              {issues.tendered}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-[9rem] flex-1 flex-col gap-1.5">
          <span className={CAPTION}>{change ? "Change" : "Amount due"}</span>
          <output
            className={cn(
              "flex h-12 items-center rounded-[10px] border px-3 font-mono text-[18px]",
              owing &&
                "border-destructive/30 bg-destructive-soft font-medium text-destructive-strong",
              change &&
                "border-success/30 bg-success-soft font-medium text-success-strong",
              !owing && !change && "border-border bg-card text-foreground",
            )}
          >
            {change
              ? // In the TENDERED currency: the customer is handed back what
                // they paid with, never the books' currency.
                formatMoney(outcome.change, currency)
              : formatMoney(outcome.amountDue, mainCurrency)}
          </output>
        </div>
      </div>

      {showCredit ? (
        <CreditBlock
          customer={credit.customer}
          onCustomerChange={credit.onCustomerChange}
          dueDate={credit.dueDate}
          onDueDateChange={credit.onDueDateChange}
          note={credit.note}
          onNoteChange={credit.onNoteChange}
          today={today}
          canPickCustomer={canPickCustomer}
          issues={issues}
          disabled={busy}
        />
      ) : null}

      {issues.cart ? (
        <p className="text-[12px] text-destructive-strong">{issues.cart}</p>
      ) : null}

      {error ? (
        // Only what `serverIssues` could not place on a control reaches here.
        // The request id is the point: it is what support asks for.
        <ErrorCard error={error} title="Couldn't record this sale" />
      ) : null}

      {/* No `sales:create`, no submit — this repo hides a control rather than
          disabling one, and `POST /sales` would answer 403 for certain.
          `RouteGuard` already gates `/sales/new` on the same permission, so
          reaching this with it missing means a role changed mid-shift. */}
      {canCreate ? (
        <button
          type="submit"
          disabled={busy}
          className="flex h-14 items-center justify-center rounded-[12px] bg-primary font-semibold text-[16px] text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        >
          {busy
            ? "Recording…"
            : outcome.paymentStatus === "paid"
              ? "Complete sale"
              : `Complete · ${outcome.paymentStatus}`}
        </button>
      ) : null}
    </form>
  );
}
