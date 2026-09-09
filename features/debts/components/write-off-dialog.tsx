"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useWriteOffDebt } from "@/features/debts/hooks/use-debt-mutations";
import { writeOffDebtSchema } from "@/features/debts/schemas/debt.schema";
import type { Debt } from "@/features/debts/types";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import { formatMoney } from "@/lib/format/money";

const CONTROL =
  "w-full rounded-[10px] border border-border bg-background px-3 py-2.5 text-sm text-foreground leading-relaxed transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

const PANEL =
  "rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong";

export interface WriteOffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The debt as this screen last fetched it — see the note on the headline. */
  debt: Debt;
  /** The organization's main currency. A `Debt` carries no currency field. */
  currency: string;
  /** "The balance on screen moved" — `DebtDetail` wires this to a refetch. */
  onStale?: () => void;
}

/**
 * Write off a debt — artboard `2g`'s second popup
 * (`docs/design/TradeOs-UI.dc.html:968-981`).
 *
 * **The headline names an amount this dialog cannot guarantee.**
 * `writeOffDebtById` is an aggregation-pipeline update that sets
 * `writtenOffAmount` from the live `$remaining` on the server
 * (`../Backend/src/db/actions/debt.actions.ts:126-141`), so the figure written
 * off is whatever is owed at that instant — `debt.remaining` here is this
 * page's last fetch, and a payment landing in between changes it. The response
 * is the fact, and `useWriteOffDebt` seeds the detail cache with it, so the
 * screen behind this dialog corrects itself on the same frame.
 *
 * **Irreversible.** There is no un-write-off endpoint in this phase
 * (`debt.service.ts:86-88`), which is the whole reason this is a dialog with a
 * required reason rather than a button.
 *
 * The one refusal worth its own words is 409 `DEBT_NOT_OPEN`. The API's message
 * ("Debt is not open") is *identical* to the one the record-payment endpoint
 * sends, and nothing on the error distinguishes them — only the fact that this
 * component called the write-off endpoint. Here it means the guard
 * `status: "open"` **and** `remaining > 0` did not match, which includes the
 * fully-paid case where there is simply nothing left to write off.
 */
export function WriteOffDialog({
  open,
  onOpenChange,
  debt,
  currency,
  onStale,
}: WriteOffDialogProps) {
  const uid = useId();
  const mutation = useWriteOffDebt();

  const [reason, setReason] = useState("");
  const [issues, setIssues] = useState<{ reason?: string; form?: string }>({});

  // Re-seeded on the way in, never on the way out: clearing on close would
  // empty the field under the closing animation, and a dialog reopened after a
  // refusal must not still hold the last attempt's reason.
  useEffect(() => {
    if (!open) return;
    setReason("");
    setIssues({});
  }, [open]);

  const close = () => onOpenChange(false);

  const failed = (error: ApiError) => {
    const fields = fieldErrorsFor(error);

    // Branch on `code`, never on `message` (CLAUDE.md).
    if (error.code === API_ERROR_CODE.DEBT_NOT_OPEN) {
      setIssues({
        form: "There is nothing left to write off on this debt — it has been paid off, already written off, or cancelled since this screen loaded.",
      });
      onStale?.();
      return;
    }

    if (fields.reason) {
      setIssues({ reason: fields.reason });
      return;
    }

    setIssues({ form: error.message });
  };

  const submit = () => {
    // The body is only a reason: `writtenOffAmount` is set from the server's
    // live `$remaining`, so there is no amount for this form to propose.
    const parsed = writeOffDebtSchema.safeParse({ reason });
    if (!parsed.success) {
      setIssues({
        reason: parsed.error.issues[0]?.message ?? "Say why.",
      });
      return;
    }

    setIssues({});
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
            {/* The amount is the question, so it is in the headline rather
                than buried in the body — this is the last screen before an
                irreversible write. */}
            Write off {formatMoney(debt.remaining, currency)}?
          </Dialog.Title>

          <Dialog.Description className="text-[13px] text-muted-foreground">
            The remaining balance is recorded as written off and the debt
            closes. Payments already taken stay as they are. This cannot be
            undone.
          </Dialog.Description>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-reason`} className="text-[13px]">
              Reason
            </Label>
            <textarea
              id={`${uid}-reason`}
              rows={3}
              value={reason}
              disabled={busy}
              placeholder="Customer closed the shop, balance unrecoverable"
              onChange={(event) => {
                setReason(event.target.value);
                setIssues({});
              }}
              aria-invalid={issues.reason ? true : undefined}
              className={cn(CONTROL, "h-[84px] resize-none")}
            />
            {issues.reason ? (
              <p role="alert" className="text-[12px] text-destructive-strong">
                {issues.reason}
              </p>
            ) : null}
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
            {/*
              The canvas draws a solid #C0392B fill with off-white text, which
              is `--destructive` / `--destructive-foreground`. The vendored
              `destructive` variant is the soft tint used for reversible
              destructive actions; a write-off is not reversible, so the fill is
              overridden with the tokens rather than with the hex.
            */}
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={submit}
              className="h-10 rounded-[10px] bg-destructive px-4 font-semibold text-[13px] text-destructive-foreground hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90"
            >
              {busy ? "Writing off…" : "Write off"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
