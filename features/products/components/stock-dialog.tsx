"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStockMutation } from "@/features/products/hooks/use-stock-mutation";
import {
  type StockMovementInput,
  stockMovementSchema,
} from "@/features/products/schemas/product.schema";
import type { StockAdjustmentResult } from "@/features/products/types";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { formatQuantity } from "@/lib/format/money";

/** The only two movements a person can post; `sale` and `sale_void` are the API's. */
export type StockDialogType = StockMovementInput["type"];

export interface StockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: ObjectId;
  /**
   * The product's quantity **as this page last saw it**. Only the preview and
   * the below-zero guard read it; the API does its own arithmetic against the
   * row it holds, which is why a stale value here is a wrong preview and never
   * a wrong write. See `docs/findings/s2-task-07.md`.
   */
  quantity: number;
  /** `pcs`, `kg` — every number in this dialog is rendered beside it. */
  unit: string;
  /** Which button opened this. Seeds the Type select; the user may change it. */
  type: StockDialogType;
  /** Title only. The dialog works without it, and the plan's test mounts it so. */
  productName?: string;
  /** The updated product and the appended row, for a caller that wants them. */
  onDone?: (result: StockAdjustmentResult) => void;
}

const TYPE_LABELS: Record<StockDialogType, string> = {
  restock: "Restock",
  adjustment: "Adjustment",
};

/** The verb on the submit button — "Restock", "Adjust". */
const ACTION_LABELS: Record<StockDialogType, string> = {
  restock: "Restock",
  adjustment: "Adjust",
};

const BLURBS: Record<StockDialogType, string> = {
  restock: "Adds to the quantity on hand and records who did it.",
  adjustment:
    "Corrects the quantity up or down. Type a negative number to remove stock; the reason is the audit trail.",
};

const CONTROL =
  "h-11 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50";

const PANEL =
  "rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong";

/**
 * Text in the box to a number, or `null` for "not a quantity yet".
 *
 * Deliberately stricter than `Number()`, which happily reads `"1e4"` as 10000
 * and `""` as 0 — the second would make an empty box preview a change of zero.
 * A lone `"-"` is `null` too, so the preview stays quiet for the keystroke
 * between the sign and the digits rather than flashing a wrong total.
 */
const parseQuantity = (raw: string): number | null => {
  const text = raw.trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/** One sentence in one element — split across two and a test could not read it. */
const shortfall = (quantity: number, unit: string): string =>
  `Only ${formatQuantity(quantity, unit)} in stock.`;

interface Issues {
  quantity?: string;
  reason?: string;
  form?: string;
}

/**
 * Restock and Adjust, as artboard `2d` draws the popup — the plan's Task 7.
 *
 * **The dialog's whole job is the preview.** `POST /products/:id/stock` takes a
 * *delta*, not a new total, and the two are easy to confuse: a shopkeeper
 * holding 48 who wants 60 types 12 here, and the only thing that tells them
 * they got that right is the `New quantity` line. Typing 60 by mistake is a
 * 108-piece shelf that nobody notices until a count.
 *
 * Two rules are enforced before anything is sent, both because the answer is
 * more useful while the number is still on screen than as a toast afterwards:
 *
 *   - **An adjustment needs a reason.** `stockMovementSchema`'s adjustment
 *     branch requires one, and so does the API. A quantity that changed for no
 *     recorded cause is exactly what the movements table exists to prevent.
 *   - **An adjustment may not drive stock below zero.** The API refuses with
 *     409 `INSUFFICIENT_STOCK`; catching it here means the message names the
 *     quantity that is actually on the shelf.
 *
 * The payload is assembled and then handed to `stockMovementSchema` rather than
 * checked field by field, so the browser refuses exactly what the backend
 * validator refuses and one file knows the rules.
 */
export function StockDialog({
  open,
  onOpenChange,
  productId,
  quantity,
  unit,
  type,
  productName,
  onDone,
}: StockDialogProps) {
  const uid = useId();
  const mutation = useStockMutation(productId);

  const [movementType, setMovementType] = useState<StockDialogType>(type);
  const [rawQuantity, setRawQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [issues, setIssues] = useState<Issues>({});

  /**
   * Re-seeded on the way in, never on the way out: clearing on close would
   * empty the fields under the closing animation, and a dialog reopened after
   * a failure must not still hold the last attempt's numbers.
   *
   * `type` is a dependency because one mounted dialog serves both buttons —
   * clicking Adjust after Restock has to land on Adjust.
   */
  useEffect(() => {
    if (!open) return;
    setMovementType(type);
    setRawQuantity("");
    setReason("");
    setIssues({});
  }, [open, type]);

  const delta = parseQuantity(rawQuantity);
  const resulting = delta === null ? null : quantity + delta;

  /**
   * The one refusal that is computed rather than reported. Only an adjustment
   * can go negative — `stockMovementSchema` already refuses a negative
   * restock — and the backend's `decrementStock` filters on
   * `quantity: { $gte: n }`, so this is the comparison the database makes.
   */
  const belowZero =
    movementType === "adjustment" && resulting !== null && resulting < 0;

  const close = () => onOpenChange(false);

  const failed = (error: ApiError) => {
    const next: Issues = {};

    for (const [field, message] of Object.entries(fieldErrorsFor(error))) {
      if (field === "quantity") next.quantity = message;
      if (field === "reason") next.reason = message;
    }

    // Branch on `code`, never on `message` (CLAUDE.md).
    if (error.code === API_ERROR_CODE.INSUFFICIENT_STOCK) {
      next.quantity =
        "There is less stock than this change removes — someone may have sold some since this page loaded. Close this, let the number refresh, then try again.";
    } else if (error.code === API_ERROR_CODE.STOCK_NOT_TRACKED) {
      next.form =
        "This product's stock is not tracked, or it has been archived. Nothing was recorded.";
    } else if (next.quantity === undefined && next.reason === undefined) {
      next.form = error.message;
    }

    setIssues(next);
  };

  const submit = () => {
    setIssues({});

    if (delta === null) {
      setIssues({ quantity: "Enter a quantity." });
      return;
    }

    if (belowZero) {
      setIssues({ quantity: shortfall(quantity, unit) });
      return;
    }

    const trimmed = reason.trim();
    const parsed = stockMovementSchema.safeParse({
      type: movementType,
      quantity: delta,
      // Omitted rather than sent blank: an absent key is what the schema's
      // required-reason branch is written against, and a restock has no reason
      // to carry an empty string to the server.
      ...(trimmed === "" ? {} : { reason: trimmed }),
    });

    if (!parsed.success) {
      const next: Issues = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "quantity") next.quantity ??= issue.message;
        else if (field === "reason") next.reason ??= issue.message;
        else next.form ??= issue.message;
      }
      setIssues(next);
      return;
    }

    mutation.mutate(parsed.data, {
      onSuccess: (result) => {
        onDone?.(result);
        close();
      },
      onError: failed,
    });
  };

  const busy = mutation.isPending;
  const action = ACTION_LABELS[movementType];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[460px] flex-col gap-4 rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex flex-col gap-1.5">
            <Dialog.Title className="font-serif text-2xl leading-tight text-foreground">
              {productName ? `${action} ${productName}` : action}
            </Dialog.Title>
            <Dialog.Description className="text-[13px] text-muted-foreground">
              {BLURBS[movementType]}
            </Dialog.Description>
          </div>

          {issues.form ? (
            <p role="alert" className={PANEL}>
              {issues.form}
            </p>
          ) : null}

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor={`${uid}-type`} className="text-[13px]">
                Type
              </Label>
              {/*
                A select rather than a fixed label, exactly as the canvas draws
                it: the two movements share every field, and someone who opened
                Restock and then found the delivery was short should not have to
                close the dialog to say so. The `type` prop seeds it.
              */}
              <select
                id={`${uid}-type`}
                value={movementType}
                disabled={busy}
                onChange={(event) => {
                  setMovementType(event.target.value as StockDialogType);
                  setIssues({});
                }}
                className={CONTROL}
              >
                {(Object.keys(TYPE_LABELS) as StockDialogType[]).map((key) => (
                  <option key={key} value={key}>
                    {TYPE_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor={`${uid}-quantity`} className="text-[13px]">
                Quantity
              </Label>
              <Input
                id={`${uid}-quantity`}
                type="text"
                // Not `type="number"`: an adjustment is a SIGNED delta, and a
                // number input has no way to express the sign on a phone's
                // decimal keypad — `inputMode` below asks for the keyboard that
                // has a minus on it. Every value is parsed by `parseQuantity`
                // and then by `stockMovementSchema`, so nothing rests on the
                // browser's own sanitising.
                inputMode={movementType === "adjustment" ? "text" : "decimal"}
                autoComplete="off"
                value={rawQuantity}
                disabled={busy}
                onChange={(event) => {
                  setRawQuantity(event.target.value);
                  // A message about a number the user has already changed is
                  // noise; the guard below recomputes as they type.
                  setIssues({});
                }}
                aria-invalid={issues.quantity || belowZero ? true : undefined}
                aria-describedby={`${uid}-outcome`}
                className={cn(CONTROL, "font-mono text-base")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-reason`} className="text-[13px]">
              Reason
              {movementType === "restock" ? (
                <span className="ml-1 font-normal text-muted-foreground">
                  (optional)
                </span>
              ) : null}
            </Label>
            <textarea
              id={`${uid}-reason`}
              rows={3}
              value={reason}
              disabled={busy}
              placeholder={
                movementType === "restock"
                  ? "Tuesday supplier delivery"
                  : "Damaged in transit"
              }
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={issues.reason ? true : undefined}
              className={cn(CONTROL, "h-auto py-2.5 leading-relaxed")}
            />
            {issues.reason ? (
              <p className="text-[12px] text-destructive">{issues.reason}</p>
            ) : null}
          </div>

          {/*
            The canvas's `New quantity` row, and the reason this is a dialog
            rather than two inline buttons: the field takes a delta and the
            shopkeeper is thinking in totals. A refusal replaces it rather than
            sitting beside it, so there is never a preview of a number the API
            has already said it will not write.
          */}
          <div id={`${uid}-outcome`}>
            {belowZero ? (
              <p className={PANEL}>
                {shortfall(quantity, unit)} This change would leave{" "}
                {formatQuantity(resulting ?? 0, unit)}.
              </p>
            ) : issues.quantity ? (
              <p className={PANEL}>{issues.quantity}</p>
            ) : (
              <div className="flex items-center justify-between gap-4 rounded-[10px] bg-muted px-3.5 py-2.5">
                <span className="text-[13px] text-muted-foreground">
                  New quantity
                </span>
                <span className="font-medium font-mono text-base text-foreground">
                  {resulting === null ? "—" : formatQuantity(resulting, unit)}
                </span>
              </div>
            )}
          </div>

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
              disabled={busy}
              onClick={submit}
              className="h-10 rounded-[10px] px-4 font-semibold text-[13px]"
            >
              {busy ? "Saving…" : action}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
