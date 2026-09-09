"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useVoidSale } from "@/features/sales/hooks/use-sale-mutations";
import { voidSaleSchema } from "@/features/sales/schemas/sale.schema";
import type { Sale } from "@/features/sales/types";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";

/** `reasonSchema` is `min(1).max(500)` (`common.validation.ts:43`). */
const REASON_MAX = 500;

const CONTROL =
  "w-full rounded-[10px] border border-border bg-background px-3 py-2.5 text-sm text-foreground leading-relaxed transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50";

const PANEL =
  "rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong";

export interface VoidSaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sale being reversed. Only `id`, `number` and `debtId` are read. */
  sale: Sale;
}

/**
 * The refusals this dialog can meet, in the words that belong beside a
 * reason someone has just typed.
 *
 * Both are **409s and both are final** — no field to fix, and no amount of
 * retrying changes the answer — so each says what state the sale is in and
 * that nothing was written, rather than offering a "try again".
 *
 * `DEBT_HAS_PAYMENTS` is checked by the server *before* stock is touched
 * (`sale.service.ts:117-130`, the debt is cancelled first inside the
 * transaction), which is why the copy can promise that nothing moved.
 */
const REFUSALS: Record<string, string> = {
  [API_ERROR_CODE.SALE_ALREADY_VOIDED]:
    "This sale has already been voided — it can only happen once. Close this and the receipt will show the void that did land.",
  [API_ERROR_CODE.DEBT_HAS_PAYMENTS]:
    "A payment has already been taken against this sale's debt, so it can no longer be voided. Nothing was changed: no stock moved and the debt is untouched. Void the payment on the debt first, or leave a correcting entry.",
};

/**
 * Void a sale — artboard `2b`'s dialog, and the plan's void flow.
 *
 * **A void is not a delete and not an edit.** It is the only state transition
 * a sale has (`completed -> voided`, one-way, at most once), it restores stock
 * for the lines whose `trackStock` was true *at sale time*, and it cancels the
 * debt the sale opened. The receipt stays readable afterwards. The blurb says
 * all three, because the person clicking is usually correcting a mistake at a
 * counter and needs to know what else moves.
 *
 * **`reason` is required** — `voidSaleSchema` is
 * `z.string().trim().min(1).max(500)` and an empty one is a 422
 * (`void.test.ts:155-161`). It is the audit trail for an irreversible action,
 * which is why it is validated here rather than left to the round trip.
 *
 * **Refusals are shown in this dialog and the dialog stays open**, per the
 * task's rule that they belong where the action was taken. A toast would put
 * the reason somewhere other than the button that caused it, and both refusals
 * are things the reader has to *decide* about (void the debt's payment first,
 * or accept that the sale is already voided) rather than acknowledge.
 */
export function VoidSaleDialog({
  open,
  onOpenChange,
  sale,
}: VoidSaleDialogProps) {
  const uid = useId();
  const mutation = useVoidSale();

  const [reason, setReason] = useState("");
  const [issue, setIssue] = useState<string | null>(null);

  /**
   * Re-seeded on the way in, never on the way out: clearing on close would
   * empty the field under the closing animation, and a dialog reopened after a
   * refusal must not still carry the previous attempt's message.
   *
   * `mutation.reset()` is deliberately **not** called here. Nothing on screen
   * reads `mutation.error` — every message goes through the local `issue`
   * state, set from `onError` — so resetting would only add a dependency on an
   * object identity that changes every render.
   */
  useEffect(() => {
    if (!open) return;
    setReason("");
    setIssue(null);
  }, [open]);

  const failed = (error: ApiError) => {
    // Branch on `code`, never on `message` (CLAUDE.md).
    const refusal = REFUSALS[error.code];
    if (refusal) {
      setIssue(refusal);
      return;
    }

    // A 422 from this route can only be about `reason` — the body has one
    // field and the params are an id the route already resolved.
    const reasonError = fieldErrorsFor(error).reason;
    setIssue(reasonError ?? error.message);
  };

  const submit = () => {
    // Assembled and handed to the schema rather than checked field by field,
    // so the browser refuses exactly what `sale.validation.ts` refuses.
    const parsed = voidSaleSchema.safeParse({ reason });

    if (!parsed.success) {
      setIssue(parsed.error.issues[0]?.message ?? "A reason is required");
      return;
    }

    setIssue(null);
    mutation.mutate(
      { id: sale.id, input: parsed.data },
      {
        onSuccess: () => onOpenChange(false),
        onError: failed,
      },
    );
  };

  const busy = mutation.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[520px] flex-col gap-4 rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex flex-col gap-2">
            <Dialog.Title className="font-serif text-2xl text-foreground leading-tight">
              Void sale {sale.number}?
            </Dialog.Title>
            <Dialog.Description className="text-[13px] text-muted-foreground text-pretty">
              Stock will be returned for tracked items
              {sale.debtId ? " and the customer's debt will be cancelled" : ""}.
              The receipt stays visible, and this cannot be undone.
            </Dialog.Description>
          </div>

          {issue ? (
            <p role="alert" className={PANEL}>
              {issue}
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${uid}-reason`}
              className="font-medium text-[13px] text-foreground"
            >
              Reason
            </label>
            <textarea
              id={`${uid}-reason`}
              rows={3}
              value={reason}
              disabled={busy}
              maxLength={REASON_MAX}
              placeholder="Wrong customer selected at the counter"
              onChange={(event) => {
                setReason(event.target.value);
                // A message about text the reader has already changed is
                // noise — except a refusal, which is about the sale and not
                // about what they typed. Both are cleared because retrying
                // with a new reason is the only thing this dialog can do, and
                // a stale refusal beside a fresh attempt is worse than none.
                setIssue(null);
              }}
              aria-invalid={issue ? true : undefined}
              aria-describedby={`${uid}-count`}
              className={cn(CONTROL, "h-[88px] resize-none")}
            />
            <p
              id={`${uid}-count`}
              className="self-end font-mono text-[11px] text-muted-foreground"
            >
              {reason.trim().length}/{REASON_MAX}
            </p>
          </div>

          <div className="flex justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              Cancel
            </Button>
            {/*
              Solid, not the soft `destructive` variant the Void *action* on
              the receipt uses. The canvas draws the two differently on
              purpose: the receipt's button opens a question, this one answers
              it, and the irreversible step is the one that should look like a
              decision. `cn` is tailwind-merge, so the fill overrides the
              variant's `bg-destructive/10` rather than fighting it.
            */}
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={submit}
              className="h-10 rounded-[10px] bg-destructive px-4 font-semibold text-[13px] text-destructive-foreground hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90"
            >
              {busy ? "Voiding…" : "Void sale"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
