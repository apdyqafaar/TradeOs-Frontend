"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { ArrowRight } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { useRemapImportColumns } from "../hooks/use-import-mutations";
import type { ColumnMapPatchInput } from "../schemas/import.schema";
import {
  type ImportJobDetail,
  PRODUCT_IMPORT_FIELDS,
  type ProductImportField,
} from "../types";

/** The ten fields, in words a shopkeeper uses rather than wire keys. */
const FIELD_LABELS: Record<ProductImportField, string> = {
  name: "Name",
  barcode: "Barcode",
  category: "Category",
  unit: "Unit",
  costPrice: "Cost price",
  sellingPrice: "Selling price",
  quantity: "Quantity",
  lowStockThreshold: "Low stock",
  trackStock: "Track stock",
  description: "Description",
};

/**
 * The three fields without which **every** row lands in "needs attention".
 *
 * There is no "required" flag anywhere on `columnMap`; requiredness is enforced
 * per row at validation time by `importRowSchema`, where `name`, `costPrice`
 * and `sellingPrice` are the only fields with no default and no `.optional()`
 * (contract §6). Everything else may be `null` here and the row is still
 * valid — `unit` falls back to `pcs`, `trackStock` to true, `quantity` to 0.
 */
const REQUIRED_FIELDS: readonly ProductImportField[] = [
  "name",
  "costPrice",
  "sellingPrice",
];

const CONTROL =
  "h-[34px] w-[180px] rounded-[9px] border border-border bg-background px-2.5 font-mono text-[12px] text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

/**
 * The file's headers, **in the order the file wrote them**.
 *
 * `raw` is keyed by the original header and survives every remap — it is what
 * a remap re-derives `parsed` from — so its key order is the spreadsheet's own
 * column order, which is what makes this screen legible to someone with the
 * file open beside it. The server derives the file's real header set from
 * exactly the same place (`product-import.service.ts:317`).
 *
 * The fallback exists only for a page of rows that came back empty under a
 * status filter. It cannot preserve column order — a `Set` over the mapped
 * headers plus `unmatchedHeaders` is the best a summary can do — so it is a
 * fallback and not the primary path.
 */
export const fileHeaders = (job: ImportJobDetail): string[] => {
  const first = job.rows[0];
  if (first) return Object.keys(first.raw);

  const mapped = PRODUCT_IMPORT_FIELDS.map(
    (field) => job.columnMap[field],
  ).filter((header): header is string => header !== null);

  return [...new Set([...mapped, ...job.unmatchedHeaders])];
};

/**
 * **`columnMap` is `field → header`; this screen is `header → field`.**
 *
 * The API answers `{ "name": "Item Name", "barcode": "SKU", … }` and artboard
 * `2e` draws one row per **file header** with a dropdown choosing the field it
 * feeds (`docs/design/TradeOs-UI.dc.html:754-760`). Rendering the JSON as it
 * arrives produces a screen keyed by our field names, which is neither the
 * design nor what someone looking at their own spreadsheet expects — they know
 * they have a column called "Sales Price", not that we have a `sellingPrice`.
 *
 * So the map is inverted to render and inverted back to `PATCH`. The inverse
 * is total: the server refuses a merged map in which two fields claim one
 * header, so no header is ever the value of two keys and a `Map` cannot lose
 * an entry (`product-import.service.ts:333-341`).
 */
export const invertColumnMap = (
  job: ImportJobDetail,
): Map<string, ProductImportField> => {
  const byHeader = new Map<string, ProductImportField>();

  for (const field of PRODUCT_IMPORT_FIELDS) {
    const header = job.columnMap[field];
    if (header !== null) byHeader.set(header, field);
  }

  return byHeader;
};

/**
 * One header's new destination, back in the API's `field → header` shape.
 *
 * **Both halves go in one call.** `{ sellingPrice: "Cost" }` alone is refused
 * when `costPrice` still holds "Cost"; `{ costPrice: null, sellingPrice:
 * "Cost" }` succeeds, because the merged map is what gets validated
 * (`import.test.ts:540-547`). Clearing the old field and claiming the new one
 * in two requests would fail on the first.
 *
 * Returns `null` when nothing would change, which is what keeps an idle
 * `change` event from firing the most destructive call in the slice.
 */
export const patchForHeader = (
  header: string,
  from: ProductImportField | null,
  to: ProductImportField | null,
): ColumnMapPatchInput["columnMap"] | null => {
  if (from === to) return null;

  const patch: ColumnMapPatchInput["columnMap"] = {};
  if (from) patch[from] = null;
  if (to) patch[to] = header;

  return Object.keys(patch).length > 0 ? patch : null;
};

/**
 * Whether anything has been written to this job since it was uploaded.
 *
 * A **heuristic, and the only one the wire allows.** No row carries an "edited"
 * flag, and the job summary has no revision count; what it does have is
 * Mongoose timestamps, which are set to the same instant at insert and bumped
 * by every mutating service call (`service.ts:366,389,409,534`). So a later
 * `updatedAt` means *something* was written — a row fix, a skip, a conflict
 * decision, or an earlier remap — and it cannot tell those apart. It is used
 * only to sharpen a warning that is shown either way, never to skip one.
 */
export const hasBeenEdited = (job: ImportJobDetail): boolean =>
  new Date(job.updatedAt).getTime() > new Date(job.createdAt).getTime();

/**
 * A refused remap, in our words rather than the server's.
 *
 * One endpoint answers **three different `errors` shapes** (contract Trap 8),
 * and the code alone does not separate them:
 *
 *   - `IMPORT_UNKNOWN_HEADER` keyed by the **product field** — the header we
 *     sent is not one of the file's own headers;
 *   - `IMPORT_UNKNOWN_HEADER` keyed by the literal **`"columnMap"`** — two
 *     fields claim one header in the merged map;
 *   - plain `VALIDATION_ERROR` keyed by `"columnMap"` — an unknown product
 *     field key, which `columnMapPatchSchema` makes unreachable from typed
 *     code but which would otherwise fall into the generic handler.
 *
 * Neither of the first two is reachable from this screen's own arithmetic: the
 * headers are rendered from the file, and every patch clears the old field in
 * the same call. Both mean the job moved underneath this page — another tab,
 * or a stale render — so both say so, and both keep the API's own sentence in
 * a `title` for a support conversation.
 */
export const remapMessage = (
  error: ApiError,
  field: ProductImportField | null,
): string => {
  if (error.code === API_ERROR_CODE.IMPORT_NOT_REVIEWING) {
    return "This import has already been committed or cancelled, so its columns can no longer be changed.";
  }

  const fields = fieldErrorsFor(error);

  if (field && fields[field]) {
    return "That column is not in this file any more. Reload this page to see the columns as they are now.";
  }

  if (fields.columnMap) {
    return "Another field is already reading that column. Reload this page — the mapping changed since it loaded.";
  }

  return error.message;
};

export interface ColumnMapStepProps {
  jobId: ObjectId;
  job: ImportJobDetail;
  /** Rendered as the step's primary action when the wizard supplies it. */
  onContinue?: () => void;
}

/**
 * Step 2 — one row per file column, each choosing the product field it feeds
 * (`docs/design/TradeOs-UI.dc.html:747-763`).
 *
 * The server has already guessed, from an alias table applied left to right
 * over the file's own header order, first match winning. This screen exists to
 * show that guess and let it be corrected — and, mostly, to be agreed with:
 * a file saved from our template maps all ten fields with nothing to do here.
 *
 * ### Why every change asks first
 *
 * `PATCH /columns` re-derives `parsed`, `notes`, `errors` and `status` from
 * `raw` for every row that is not `skipped`, and clears their conflicts
 * (`product-import.service.ts:355-363`). It is the most destructive call in
 * the slice and it looks like a dropdown. The backend's own integration test
 * has to redo its edits after one. So the dialog is unconditional, and it says
 * what is lost rather than asking "are you sure?".
 *
 * It is also the reason this step comes *before* the review table rather than
 * beside it: settle the mapping first and no fix is thrown away.
 */
export function ColumnMapStep({ jobId, job, onContinue }: ColumnMapStepProps) {
  // Ids are built from `uid` and the column's position, never from the header
  // itself: a real spreadsheet heading contains spaces, and `aria-describedby`
  // is a space-separated list of ids — "Sales Price" in an id silently points
  // the select at two elements that do not exist.
  const uid = useId();
  const remap = useRemapImportColumns();
  const [pending, setPending] = useState<{
    header: string;
    to: ProductImportField | null;
    patch: ColumnMapPatchInput["columnMap"];
  } | null>(null);
  /** Which control refused, so the message lands on it and not on the panel. */
  const [failure, setFailure] = useState<{
    header: string;
    field: ProductImportField | null;
    error: ApiError;
  } | null>(null);

  const headers = fileHeaders(job);
  const byHeader = invertColumnMap(job);

  const missing = REQUIRED_FIELDS.filter(
    (field) => job.columnMap[field] === null,
  );

  const propose = (header: string, next: string) => {
    const to = next === "" ? null : (next as ProductImportField);
    const patch = patchForHeader(header, byHeader.get(header) ?? null, to);
    if (!patch) return;

    setFailure(null);
    setPending({ header, to, patch });
  };

  const confirm = () => {
    if (!pending) return;
    const { header, to, patch } = pending;

    remap.mutate(
      { jobId, input: { columnMap: patch } },
      {
        onSuccess: () => setPending(null),
        onError: (error) => {
          setPending(null);
          setFailure({ header, field: to, error });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        Step 2 · Map columns
      </span>

      {/* `<output>` rather than a `<p role="status">`: it carries that role
          natively, and this line changes as columns are pointed at fields, so
          a screen reader should hear it without the focus moving. */}
      {missing.length > 0 ? (
        <output className="block rounded-[10px] border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning-strong">
          Nothing feeds {missing.map((field) => FIELD_LABELS[field]).join(", ")}{" "}
          yet. A product needs all three, so every row will need attention until
          a column is pointed at {missing.length === 1 ? "it" : "them"}.
        </output>
      ) : null}

      <div className="overflow-hidden rounded-[10px] border border-border bg-card">
        <ul>
          {headers.map((header, index) => {
            const field = byHeader.get(header) ?? null;
            const refusal = failure?.header === header ? failure : null;
            const controlId = `${uid}-${index}`;

            return (
              <li
                key={header}
                className="flex flex-wrap items-center gap-3 border-border/60 border-b px-4 py-2.5 last:border-b-0"
              >
                <label
                  htmlFor={controlId}
                  className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground"
                  title={header}
                >
                  {header}
                </label>

                <ArrowRight
                  className="size-4 flex-none text-border-strong"
                  aria-hidden="true"
                />

                <select
                  id={controlId}
                  value={field ?? ""}
                  disabled={remap.isPending}
                  aria-invalid={refusal ? true : undefined}
                  aria-describedby={refusal ? `${controlId}-error` : undefined}
                  onChange={(event) => propose(header, event.target.value)}
                  className={cn(CONTROL, "flex-none")}
                >
                  {/* Not "ignore" — the column is not being suppressed, it is
                      simply not one of the ten things a product has. */}
                  <option value="">Not imported</option>
                  {PRODUCT_IMPORT_FIELDS.map((option) => {
                    const takenBy = job.columnMap[option];
                    const elsewhere = takenBy !== null && takenBy !== header;

                    return (
                      <option key={option} value={option}>
                        {FIELD_LABELS[option]}
                        {/* Choosing it is legal and works in one call — the
                            other column simply stops being imported — but the
                            user should know that is what they are doing. */}
                        {elsewhere ? ` — now ${takenBy}` : ""}
                      </option>
                    );
                  })}
                </select>

                {refusal ? (
                  <p
                    id={`${controlId}-error`}
                    role="alert"
                    // The API's own sentence stays reachable for a support
                    // conversation without being the primary text — the same
                    // rule the review table follows for zod messages.
                    title={refusal.error.message}
                    className="w-full text-[12px] text-destructive-strong"
                  >
                    {remapMessage(refusal.error, refusal.field)}
                    {refusal.error.requestId ? (
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        Request ID: {refusal.error.requestId}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {/* `unmatchedHeaders` as the server computes it, not as this screen
          infers it. They are ignored, not broken — nothing is wrong with a
          file that also tracks a supplier — so this is a quiet statement of
          fact rather than a warning. */}
      {job.unmatchedHeaders.length > 0 ? (
        <p className="text-[12px] text-muted-foreground">
          {job.unmatchedHeaders.length === 1
            ? "One column is not imported"
            : `${job.unmatchedHeaders.length} columns are not imported`}
          :{" "}
          <span className="font-mono text-[11px]">
            {job.unmatchedHeaders.join(", ")}
          </span>
          . They stay in your file; nothing is read from them.
        </p>
      ) : null}

      {onContinue ? (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={onContinue}
            className="h-10 rounded-[10px] px-4 text-[13px]"
          >
            These look right — review the rows
          </Button>
        </div>
      ) : null}

      <RemapDialog
        header={pending?.header ?? null}
        to={pending?.to ?? null}
        job={job}
        busy={remap.isPending}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      />
    </div>
  );
}

interface RemapDialogProps {
  header: string | null;
  to: ProductImportField | null;
  job: ImportJobDetail;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The confirmation in front of `PATCH /columns`.
 *
 * Shown for every change, including the first one on an untouched job, because
 * the destruction is a property of the endpoint rather than of how much work
 * has been done: the rows are re-derived either way. What `hasBeenEdited` adds
 * is a second sentence when there is known to be something to lose.
 */
function RemapDialog({
  header,
  to,
  job,
  busy,
  onCancel,
  onConfirm,
}: RemapDialogProps) {
  const edited = hasBeenEdited(job);

  return (
    <Dialog.Root
      open={header !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[460px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-serif text-2xl leading-tight text-foreground">
            Read every row again?
          </Dialog.Title>

          <Dialog.Description className="text-[13px] text-muted-foreground">
            {header ? (
              <>
                <span className="font-mono text-[12px] text-foreground">
                  {header}
                </span>{" "}
                will feed{" "}
                <span className="font-medium text-foreground">
                  {to ? FIELD_LABELS[to] : "nothing"}
                </span>
                . Changing a column re-reads all{" "}
                {job.totalRows.toLocaleString()} rows from your file, so any fix
                already made to a row — a corrected price, a category typed in,
                a decision about a barcode clash — is undone. Rows you skipped
                stay skipped.
                {edited ? (
                  <>
                    {" "}
                    <span className="text-warning-strong">
                      This import has been edited since it was uploaded.
                    </span>
                  </>
                ) : null}
              </>
            ) : null}
          </Dialog.Description>

          <div className="flex justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onCancel}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              Leave it as it is
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="h-10 rounded-[10px] px-4 font-semibold text-[13px]"
            >
              {busy ? "Re-reading…" : "Change the column"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
