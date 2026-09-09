"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { useEffect, useId, useState } from "react";
import { CurrencyToggle } from "@/components/shared/currency-toggle";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRecordPayment } from "@/features/debts/hooks/use-debt-mutations";
import {
  PAYMENT_CONFLICT_FIELDS,
  type RecordPaymentInput,
  recordPaymentSchema,
  remainingFromPaymentError,
} from "@/features/debts/schemas/debt.schema";
import type { Debt } from "@/features/debts/types";
import { useCurrencyConfig } from "@/features/organization/hooks/use-currency-config";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import { formatMoney } from "@/lib/format/money";

/**
 * `round2` from `../Backend/src/lib/money.ts:18`, for the preview only.
 *
 * `Math.round` is half-up and the backend's is half-away-from-zero; every
 * amount in this dialog is positive, where the two agree. Nothing this returns
 * is ever sent — the API recomputes it from `amount` and its own live rate.
 */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * `toMain` (`money.ts:28`) — it **multiplies**, and getting this backwards is
 * the single most expensive mistake in this slice: `exchangeRate` is units of
 * MAIN per one unit of EXCHANGE, so dividing produces a number off by roughly
 * the square of the real rate. It read KES 0.77 for a KES 13,000 tender once.
 */
const toMain = (amount: number, rate: number): number => round2(amount * rate);

/**
 * `resolveRate` (`../Backend/src/services/debt.service.ts:25-38`), mirrored:
 * `1` for the main currency, the configured rate for the exchange currency.
 * The server resolves its own rate at write time and freezes it onto the
 * record — this copy exists only to price the preview, and the number that
 * ends up on the payment is the server's.
 */
const rateFor = (
  selected: string,
  mainCurrency: string,
  exchangeRate: number,
): number => (selected === mainCurrency ? 1 : exchangeRate);

/**
 * The largest amount the API can accept, expressed in the currency the toggle
 * has selected — artboard `2g`'s `max USD 167.75` hint.
 *
 * In the main currency that is `remaining` exactly. In the exchange currency it
 * is `remaining / rate` **floored** to two decimals, not rounded: rounding up
 * can push `amount * rate` past `remaining` by more than the server's one-cent
 * overshoot tolerance, which is a 422 on a hint the screen itself suggested.
 * Flooring can leave a sub-unit residue instead, which is why "Pay in full" is
 * not offered in the exchange currency — see the note on the component.
 */
const maxIn = (remaining: number, rate: number): number | undefined => {
  if (rate === 1) return remaining;
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  return Math.floor((remaining / rate) * 100) / 100;
};

const PANEL =
  "rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong";

interface Issues extends Partial<Record<keyof RecordPaymentInput, string>> {
  /** A refusal with no field to blame — the debt itself moved. */
  form?: string;
}

export interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The debt **as this screen last fetched it**. Only the `max` hint and the
   * "Remaining after this" preview read `remaining`; the API does its own
   * arithmetic against the row it holds inside a guarded transaction, so a
   * stale value here is a wrong preview and never a wrong write.
   */
  debt: Debt;
  /**
   * "The balance on screen can no longer be trusted — go and ask the server."
   *
   * Called for every refusal that means the debt moved underneath this dialog:
   * the 409 race, `DEBT_NOT_OPEN`, a 404, and the 422 whose `details.remaining`
   * disagrees with what is on screen. `DebtDetail` wires it to a refetch.
   */
  onStale?: () => void;
}

/**
 * Record a payment — artboard `2g`'s first popup
 * (`docs/design/TradeOs-UI.dc.html:936-966`).
 *
 * **`PAYMENT_EXCEEDS_BALANCE` is one code with two shapes, and they are two
 * different sentences to a person.**
 *
 *   - **422**, from the pre-transaction check. It carries `details.remaining`
 *     *and* `errors: { amount }`, so it already lands on the amount box
 *     unaided; the copy here replaces the API's generic sentence with one that
 *     names the balance the server just quoted, because that is the number the
 *     reader has to type under.
 *   - **409**, when a concurrent payment won the guarded update inside the
 *     transaction. It carries **neither** — the server does not claim to know
 *     the balance any more, so printing the figure this screen was holding
 *     would be dressing up a number the API has just called stale. The honest
 *     message is that somebody else paid against this debt a moment ago, and
 *     `onStale` goes and gets the real figure.
 *
 * `PAYMENT_CONFLICT_FIELDS` is what puts the 409 on the amount box at all: it
 * arrives with no field map of its own, and the amount is the one thing the
 * reader can change.
 *
 * **"Pay in full" appears only in the main currency.** The debt's balance is
 * held in the main currency and generally cannot be expressed exactly in the
 * exchange one — at a rate of 130, a KES 1,000 balance is USD 7.6923…, and
 * neither 7.69 (leaves 0.30 owing) nor 7.70 (overshoots by 1.00, past the
 * server's one-cent tolerance, a 422) settles it. A button labelled "Pay in
 * full" that does not close the debt is a lie, so the max hint stands alone
 * there. The canvas draws the affordance unconditionally; this is the one
 * place this screen knowingly departs from it.
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  debt,
  onStale,
}: RecordPaymentDialogProps) {
  const uid = useId();
  const mutation = useRecordPayment();
  const {
    mainCurrency,
    exchangeRate,
    isLoading: currencyLoading,
  } = useCurrencyConfig();

  const [selected, setSelected] = useState(mainCurrency);
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [issues, setIssues] = useState<Issues>({});

  /**
   * Re-seeded on the way in, never on the way out: clearing on close would
   * empty the fields under the closing animation, and a dialog reopened after
   * a refusal must not still hold the last attempt's amount.
   *
   * `mainCurrency` is a dependency because it can arrive after the first open
   * — `useCurrencyConfig` is a second request. `CurrencyToggle` leaves both
   * radios unchecked for a `value` matching neither option rather than
   * guessing, so seeding it late here is what actually selects one.
   */
  useEffect(() => {
    if (!open) return;
    setSelected(mainCurrency);
    setAmount(null);
    setNote("");
    setIssues({});
  }, [open, mainCurrency]);

  const rate = rateFor(selected, mainCurrency, exchangeRate);
  const max = maxIn(debt.remaining, rate);
  const amountMain = amount === null ? null : toMain(amount, rate);

  /*
   * The canvas's "Remaining after this". A preview and nothing more: the
   * server clamps a sub-cent overshoot to the balance and forces `remaining`
   * to exactly `0` once the leftover falls to 0.004 or less, tolerances that
   * are never on the wire. `null` for an amount the debt cannot absorb —
   * showing `0.00` there would promise a settlement the API is about to
   * refuse.
   */
  const remainingAfter =
    amountMain === null || amountMain > debt.remaining
      ? null
      : round2(debt.remaining - amountMain);

  const close = () => onOpenChange(false);

  const failed = (error: ApiError) => {
    const next: Issues = {};

    // A 422 arrives with its own field map; `fieldErrorsFor` routes it before
    // any of the branches below get a chance to say something better.
    for (const [field, message] of Object.entries(fieldErrorsFor(error))) {
      if (field === "amount" || field === "currency" || field === "note") {
        next[field] = message;
      }
    }

    // Branch on `code`, never on `message` (CLAUDE.md).
    if (error.code === API_ERROR_CODE.PAYMENT_EXCEEDS_BALANCE) {
      // The map exists because the 409 has no field errors of its own, and the
      // amount is the only thing the reader can change.
      const field =
        PAYMENT_CONFLICT_FIELDS[
          error.code as keyof typeof PAYMENT_CONFLICT_FIELDS
        ];
      const serverRemaining = remainingFromPaymentError(error);

      next[field] =
        serverRemaining === undefined
          ? "Someone else recorded a payment against this debt while this one was going through, so this amount no longer fits. Nothing was taken from this one — the balance above is refreshing."
          : `That is more than the ${formatMoney(serverRemaining, mainCurrency)} still owed on this debt.`;

      onStale?.();
    } else if (error.code === API_ERROR_CODE.DEBT_NOT_OPEN) {
      // The same code and the same API message ("Debt is not open") come back
      // from the write-off endpoint for a different situation. Which call
      // raised it is the only thing that tells them apart, so the wording is
      // specific to this one.
      next.form =
        "This debt is no longer open — it has been settled, written off or cancelled since this screen loaded. Nothing was recorded.";
      onStale?.();
    } else if (error.status === 404) {
      // `recordPayment` resolves the rate *before* it loads the debt, so a 404
      // here is either "no such debt" or "this business has no currency
      // configuration" — same code, and this repo never branches on the
      // message. Refetching resolves the ambiguity by showing whether the debt
      // is still there; nothing is removed from the cache on the strength of it.
      next.form =
        "That payment couldn't be recorded. Refreshing this debt to see where it stands.";
      onStale?.();
    } else if (
      next.amount === undefined &&
      next.currency === undefined &&
      next.note === undefined
    ) {
      next.form = error.message;
    }

    setIssues(next);
  };

  const submit = () => {
    setIssues({});

    /*
     * The payload is assembled and handed to `recordPaymentSchema` rather than
     * checked field by field, so the browser refuses exactly what the backend
     * validator refuses and one file knows the rules. `note` goes in as typed:
     * the schema collapses a blank one to `undefined`, and `JSON.stringify`
     * then drops the key, which is what "no note" means to the API.
     *
     * An amount over `max` is deliberately **not** blocked here. The server
     * clamps an overshoot of a cent or less rather than refusing it, and that
     * tolerance is not on the wire — a local refusal would invent one the API
     * would not make. `MoneyInput` already flags the amount as over the max,
     * and the 422 comes back naming the server's own balance.
     */
    const parsed = recordPaymentSchema.safeParse({
      amount,
      currency: selected,
      note,
    });

    if (!parsed.success) {
      const next: Issues = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "amount" || field === "currency" || field === "note") {
          next[field] ??= issue.message;
        } else {
          next.form ??= issue.message;
        }
      }
      setIssues(next);
      return;
    }

    mutation.mutate(
      { debtId: debt.id, input: parsed.data },
      { onSuccess: close, onError: failed },
    );
  };

  const busy = mutation.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[460px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-serif text-2xl leading-tight text-foreground">
            Record payment
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Money received against this debt. Amounts are recorded in the
            business's main currency.
          </Dialog.Description>

          <div className="flex flex-col gap-1.5">
            {/*
              Renders nothing at all for a single-currency business, and
              nothing while the configuration is still loading — so this dialog
              must not lay out around it. `value` is seeded with `mainCurrency`
              above; a value matching neither option would leave both radios
              unchecked, because the control will not guess which currency the
              money came in as.
            */}
            <CurrencyToggle
              value={selected}
              onChange={(code) => {
                setSelected(code);
                // The amount was typed in the old currency; keeping the digits
                // would silently re-denominate them.
                setAmount(null);
                setIssues({});
              }}
              label="Currency received"
              disabled={busy}
            />
            {issues.currency ? (
              <p role="alert" className="text-[12px] text-destructive-strong">
                {issues.currency}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <MoneyInput
              id={`${uid}-amount`}
              label="Amount"
              value={amount}
              onChange={(next) => {
                setAmount(next);
                // A message about a number the reader has already changed is
                // noise.
                setIssues({});
              }}
              currency={selected}
              mainCurrency={mainCurrency}
              exchangeRate={exchangeRate}
              max={max}
              fillLabel={rate === 1 ? "Pay in full" : undefined}
              disabled={busy || currencyLoading}
              placeholder="0.00"
            />
            {/*
              `MoneyInput` owns its own `aria-describedby` (the currency note,
              the max hint, the converted line) and takes no error slot, so the
              refusal is announced by `role="alert"` instead of being wired
              into the field's description. It sits directly under the box it
              belongs to either way.
            */}
            {issues.amount ? (
              <p role="alert" className="text-[12px] text-destructive-strong">
                {issues.amount}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-note`} className="text-[13px]">
              Note
              <span className="ml-1 font-normal text-muted-2">optional</span>
            </Label>
            <Input
              id={`${uid}-note`}
              type="text"
              autoComplete="off"
              value={note}
              disabled={busy}
              placeholder="Cash at the shop"
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={issues.note ? true : undefined}
              className="h-11 rounded-[10px] border-border bg-background px-3 text-sm"
            />
            {issues.note ? (
              <p role="alert" className="text-[12px] text-destructive-strong">
                {issues.note}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-4 rounded-[10px] bg-muted px-3.5 py-2.5">
            <span className="text-[13px] text-muted-foreground">
              Remaining after this
            </span>
            <span className="font-medium font-mono text-base text-foreground">
              {remainingAfter === null
                ? "—"
                : formatMoney(remainingAfter, mainCurrency)}
            </span>
          </div>

          {issues.form ? (
            <div className={cn(PANEL, "flex flex-col items-start gap-2")}>
              <p role="alert">{issues.form}</p>
              {onStale ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onStale();
                    close();
                  }}
                >
                  Refresh this debt
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || currencyLoading}
              onClick={submit}
              className="h-10 rounded-[10px] px-4 font-semibold text-[13px]"
            >
              {busy ? "Recording…" : "Record payment"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
