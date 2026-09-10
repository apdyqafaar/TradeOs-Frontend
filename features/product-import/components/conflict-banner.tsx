"use client";

import { cn } from "cn";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useProduct } from "@/features/products/hooks/use-product";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { formatMoney, formatQuantity } from "@/lib/format/money";
import { useResolveImportConflict } from "../hooks/use-import-mutations";
import { spreadsheetRowNumber } from "../schemas/import.schema";
import type { ImportConflictResolution, ImportRow } from "../types";

export interface ConflictBannerProps {
  jobId: ObjectId;
  /** A row whose `status` is `"conflict"`. */
  row: ImportRow;
  /** The organization's main currency — an import job carries none. */
  currency: string;
  /** "this row is no longer a conflict" — the table re-reads on this. */
  onStale?: () => void;
}

/**
 * Artboard `2e`'s conflict banner — the row whose barcode already belongs to a
 * product this business stocks.
 *
 * ### The parenthetical the design draws cannot be rendered from this row
 *
 * The canvas reads:
 *
 * > Row 21 · `6001234567890` already belongs to **Basmati rice 5 kg**
 * > (USD 12.40, 3 pcs)
 *
 * The observed `conflict` object has **two keys and no more**
 * (`docs/findings/slice4-import-live-observations.md` §2):
 *
 * ```json
 * { "existingProductId": "6aa178be…", "existingName": "Coca-Cola 500ml" }
 * ```
 *
 * The name is there. **The price and the quantity are not**, and there is no
 * bulk endpoint to fetch them — a file with fifty conflicts would be fifty
 * `GET /products/:id` calls for a parenthetical.
 *
 * So the banner ships the honest half of the finding's two options: **the name
 * always, the figures on demand.** Pressing *Compare* fetches this one product
 * and shows its price and stock **beside the imported row's**, because the
 * comparison is the entire purpose of that line — and the two numbers are
 * deliberately labelled, so the imported row's price can never be mistaken for
 * the existing product's. Neither figure is ever invented.
 *
 * ### A resolved conflict still reads as a conflict everywhere else
 *
 * `resolveConflict` writes `conflict.resolution` and **leaves
 * `status: "conflict"`** (`product-import.service.ts:434`, asserted at
 * `import.test.ts:305-307`), so neither the row's status nor `counts.conflict`
 * moves when the reviewer decides. This banner is therefore the only place the
 * decision is visible, which is why it states it rather than relying on the
 * badge or the tab count — and why it says out loud that the count will not
 * change.
 */
export function ConflictBanner({
  jobId,
  row,
  currency,
  onStale,
}: ConflictBannerProps) {
  const [comparing, setComparing] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const mutation = useResolveImportConflict();

  const conflict = row.conflict;

  // One request, and only once someone asks for it. `useProduct` is disabled
  // while the id is `undefined`, so the fifty-conflict file costs nothing until
  // a reviewer opens a specific one. Called before the guard below, because a
  // hook may not sit behind an early return.
  const existing = useProduct(
    comparing && conflict ? conflict.existingProductId : undefined,
  );

  // `status` is the key, not the presence of this object (contract §14) — but
  // without it there is nothing to name, so the banner steps aside.
  if (!conflict) return null;

  const resolve = (resolution: ImportConflictResolution) => {
    setRefusal(null);
    mutation.mutate(
      { jobId, index: row.index, input: { resolution } },
      {
        onError: (error: ApiError) => {
          // Branch on `code`, never on `message` (CLAUDE.md).
          if (error.code === API_ERROR_CODE.IMPORT_ROW_NOT_CONFLICT) {
            setRefusal(
              "This row is not a conflict any more — it was edited since this screen loaded, which clears the conflict until the file is re-checked.",
            );
            onStale?.();
            return;
          }
          if (error.code === API_ERROR_CODE.IMPORT_NOT_REVIEWING) {
            setRefusal(
              "This import has already been committed or cancelled, so its rows can no longer be changed.",
            );
            onStale?.();
            return;
          }
          setRefusal(error.message);
        },
      },
    );
  };

  const busy = mutation.isPending;
  const decided = conflict.resolution;

  return (
    <div
      data-slot="import-conflict"
      className="flex flex-col gap-2.5 border-border border-b bg-destructive-soft/40 px-4 py-3.5 last:border-0"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex h-[22px] flex-none items-center rounded-lg bg-destructive-soft px-2 font-medium text-[11px] text-destructive-strong">
          Conflict
        </span>

        <p className="min-w-[16rem] flex-1 text-[13px] text-foreground">
          Row {spreadsheetRowNumber(row.index)}
          {row.parsed.barcode ? (
            <>
              {" · "}
              <span className="font-mono text-[12px]">
                {row.parsed.barcode}
              </span>
            </>
          ) : null}{" "}
          already belongs to{" "}
          <span className="font-medium">{conflict.existingName}</span>
        </p>

        {decided ? (
          <p className="flex-none text-[12px] text-muted-foreground">
            {decided === "update"
              ? "Set to update the existing product"
              : "Set to leave the existing product alone"}
          </p>
        ) : null}

        <div className="flex flex-none items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-expanded={comparing}
            onClick={() => setComparing((open) => !open)}
            className="h-8 rounded-[9px] px-2.5 text-[12px]"
          >
            {comparing ? "Hide comparison" : "Compare"}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            aria-pressed={decided === "skip"}
            onClick={() => resolve("skip")}
            className={cn(
              "h-8 rounded-[9px] px-3 font-medium text-[12px]",
              decided === "skip" && "border-foreground/40 bg-muted",
            )}
          >
            Skip
          </Button>

          {/* The canvas draws this as the tinted primary — a #D97757 border on
              #F6E7DF, which is `--primary` on `--primary-soft`. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            aria-pressed={decided === "update"}
            onClick={() => resolve("update")}
            className={cn(
              "h-8 rounded-[9px] border-primary bg-primary-soft px-3 font-medium text-[12px] text-primary-soft-foreground hover:bg-primary-soft hover:text-primary-soft-foreground",
              decided === "update" && "ring-2 ring-primary/40",
            )}
          >
            Update existing
          </Button>
        </div>
      </div>

      {comparing ? (
        <div className="grid grid-cols-1 gap-3 rounded-[10px] border border-border bg-card px-3.5 py-3 sm:grid-cols-2">
          <Side
            title="Already in your products"
            subtitle={conflict.existingName}
            price={existing.data?.sellingPrice}
            cost={existing.data?.costPrice}
            quantity={
              existing.data?.trackStock === false
                ? undefined
                : existing.data?.quantity
            }
            unit={existing.data?.unit}
            currency={currency}
            isLoading={existing.isPending}
            error={
              existing.error
                ? existing.error.status === 404
                  ? "That product is no longer here — it may have been removed since the file was checked."
                  : existing.error.message
                : null
            }
          />
          <Side
            title="This row in your file"
            subtitle={row.parsed.name ?? "No name in this row"}
            price={row.parsed.sellingPrice}
            cost={row.parsed.costPrice}
            quantity={
              row.parsed.trackStock === false ? undefined : row.parsed.quantity
            }
            unit={row.parsed.unit}
            currency={currency}
            isLoading={false}
            error={null}
          />
        </div>
      ) : null}

      {refusal ? (
        <p role="alert" className="text-[12px] text-destructive-strong">
          {refusal}
        </p>
      ) : null}

      {decided ? (
        // Said plainly because the screen cannot show it any other way: the
        // status badge and the "Conflicts" tab count both stay exactly where
        // they were, and a reviewer who has done the work deserves to know the
        // unchanged number is not a failed save.
        <p className="text-[11px] text-muted-foreground">
          Decided rows stay listed as conflicts until the import runs, so this
          count will not go down.
        </p>
      ) : null}
    </div>
  );
}

interface SideProps {
  title: string;
  subtitle: string;
  price?: number;
  cost?: number;
  /** Absent for a service item, which has no stock at all. */
  quantity?: number;
  unit?: string;
  currency: string;
  isLoading: boolean;
  error: string | null;
}

/**
 * One half of the comparison. The two halves are labelled rather than merged
 * because the imported row's price and the live product's price are different
 * numbers, and the observation file is explicit that showing one where the
 * other belongs defeats the purpose of the line.
 */
function Side({
  title,
  subtitle,
  price,
  cost,
  quantity,
  unit,
  currency,
  isLoading,
  error,
}: SideProps) {
  const money = (value?: number) =>
    value === undefined ? "—" : formatMoney(value, currency);

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </span>
      <span className="text-[13px] text-foreground">{subtitle}</span>

      {error ? (
        <span className="text-[12px] text-destructive-strong">{error}</span>
      ) : isLoading ? (
        <span className="text-[12px] text-muted-foreground">
          Looking it up…
        </span>
      ) : (
        <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
          <dt className="text-muted-foreground">Price</dt>
          <dd className="font-mono text-foreground">{money(price)}</dd>
          <dt className="text-muted-foreground">Cost</dt>
          <dd className="font-mono text-foreground">{money(cost)}</dd>
          <dt className="text-muted-foreground">Stock</dt>
          <dd className="font-mono text-foreground">
            {quantity === undefined
              ? "Not tracked"
              : formatQuantity(quantity, unit)}
          </dd>
        </dl>
      )}
    </div>
  );
}
