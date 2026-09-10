"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { usePatchImportRow } from "../hooks/use-import-mutations";
import {
  importRowPatchSchema,
  spreadsheetRowNumber,
} from "../schemas/import.schema";
import type { ImportColumnMap, ImportRow, ProductImportField } from "../types";
import { importFieldLabel, rowMessages } from "./row-message";

const CONTROL =
  "w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

/**
 * The row's ten editable fields, in the order a reviewer reads a product.
 *
 * `categoryId` and `images` are deliberately absent and must stay absent: both
 * are `unrecognized_keys` 422s on this endpoint (contract §7). The category is
 * changed by sending its **name** in `category`.
 */
const TEXT_FIELDS = [
  "name",
  "barcode",
  "category",
  "unit",
  "description",
] as const;
const NUMBER_FIELDS = [
  "costPrice",
  "sellingPrice",
  "quantity",
  "lowStockThreshold",
] as const;

type TextField = (typeof TEXT_FIELDS)[number];
type NumberField = (typeof NUMBER_FIELDS)[number];

/** Every field's draft is a string; the numbers are parsed once, on submit. */
type Draft = Record<ProductImportField, string>;

const toDraft = (row: ImportRow): Draft => ({
  name: row.parsed.name ?? "",
  barcode: row.parsed.barcode ?? "",
  category: row.parsed.category ?? "",
  unit: row.parsed.unit ?? "",
  description: row.parsed.description ?? "",
  costPrice: row.parsed.costPrice?.toString() ?? "",
  sellingPrice: row.parsed.sellingPrice?.toString() ?? "",
  quantity: row.parsed.quantity?.toString() ?? "",
  lowStockThreshold: row.parsed.lowStockThreshold?.toString() ?? "",
  // A select, not a text box — but keeping one draft shape means one diff.
  trackStock:
    row.parsed.trackStock === undefined ? "" : String(row.parsed.trackStock),
});

/** `""` and `"."` are empty, not zero. `Number("")` is 0, which is a real bug. */
const parseNumber = (draft: string): number | null => {
  const trimmed = draft.trim();
  if (trimmed === "" || trimmed === ".") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

export interface FixRowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: ObjectId;
  /** The row as the review table last fetched it. */
  row: ImportRow;
  /** Field → header, so the dialog can show the reviewer their own cell. */
  columnMap: ImportColumnMap;
  /** "the row is gone / the job closed" — the table re-reads on this. */
  onStale?: () => void;
}

/**
 * Fix one staged row — `PATCH /products/import/:id/rows/:index`.
 *
 * ### It sends only what changed, and that is not defensive caution
 *
 * The contract's Trap 1 says to echo `unit`, `trackStock` and `quantity` on
 * every patch, and **that advice is stale**: it was written against a zod
 * defaults leak that `Backend` commit `48c7205` fixed
 * (`docs/findings/slice4-import-data.md` §1). Echoing them today writes three
 * fields the reviewer did not touch — which is exactly the corruption the fix
 * removed. So the body is a diff against the row's own `parsed`, and an empty
 * diff is never sent at all: the same commit un-vacuous-ed the
 * `"Nothing to update"` refine, so `{}` is now a genuine 422.
 *
 * ### A number that is already in the file cannot be cleared here
 *
 * `editRow` merges (`merged = { ...row.parsed, ...patch }`,
 * `product-import.service.ts:372-394`) and the patch schema has no `null`, so
 * there is no way to *remove* a numeric value once the file supplied one. The
 * one deletable field is the category, and only via the empty string —
 * `resolveRowCategories` drops both `parsed.category` and `parsed.categoryId`
 * when the trimmed name is falsy. Emptying a number box is therefore refused
 * with a sentence rather than silently dropped from the diff.
 *
 * ### Editing a conflicted row throws its decision away
 *
 * `editRow` clears `conflict` before re-reconciling and the reconcile pass
 * re-creates it with **no `resolution`** (`service.ts:386,178`). The reviewer
 * is told before they save, because a Commit button that was enabled a moment
 * ago will correctly go back to blocked and they need to know why.
 */
export function FixRowDialog({
  open,
  onOpenChange,
  jobId,
  row,
  columnMap,
  onStale,
}: FixRowDialogProps) {
  const uid = useId();
  const mutation = usePatchImportRow();

  const [draft, setDraft] = useState<Draft>(() => toDraft(row));
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Re-seeded on the way in, never on the way out: clearing on close would
  // empty the fields under the closing animation, and a dialog reopened after
  // a refusal must not still hold the last attempt's values. `row.index` is in
  // the deps because the table reuses one dialog for every row.
  useEffect(() => {
    if (!open) return;
    setDraft(toDraft(row));
    setIssues({});
    setFormError(null);
  }, [open, row]);

  const close = () => onOpenChange(false);
  const set = (field: ProductImportField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setIssues(({ [field]: _dropped, ...rest }) => rest);
    setFormError(null);
  };

  const messages = rowMessages(row, columnMap);
  const problems = new Set(
    messages.filter((m) => m.tone === "problem").map((m) => m.field),
  );

  const failed = (error: ApiError) => {
    // Branch on `code`, never on `message` (CLAUDE.md).
    if (error.code === API_ERROR_CODE.IMPORT_ROW_NOT_FOUND) {
      setFormError(
        "This row is no longer part of the import. Reload the review to see what changed.",
      );
      onStale?.();
      return;
    }

    if (error.code === API_ERROR_CODE.IMPORT_NOT_REVIEWING) {
      setFormError(
        "This import has already been committed or cancelled, so its rows can no longer be changed.",
      );
      onStale?.();
      return;
    }

    const fields = fieldErrorsFor(error);
    // `zodToFieldErrors` keys an object-level issue as the literal `"_"`
    // (`error.middleware.ts:9-16`), so a form with nowhere to put a `_` shows
    // nothing at all for the two refusals that use it.
    const { _: objectLevel, ...rest } = fields;
    if (Object.keys(rest).length > 0) setIssues(rest);
    setFormError(
      objectLevel ?? (Object.keys(rest).length ? null : error.message),
    );
  };

  const submit = () => {
    const patch: Record<string, string | number | boolean> = {};
    const next: Record<string, string> = {};

    for (const field of TEXT_FIELDS) {
      const value = draft[field].trim();
      const before = row.parsed[field as TextField] ?? "";
      if (value !== before) patch[field] = value;
    }

    for (const field of NUMBER_FIELDS) {
      const before = row.parsed[field as NumberField];
      const value = parseNumber(draft[field]);
      if (value === null) {
        // See the note above: there is no way to unset a number on this
        // endpoint, so an emptied box is a refusal rather than a silent no-op.
        if (before !== undefined)
          next[field] =
            `${importFieldLabel(field)} cannot be emptied here — give a number, or skip the row.`;
        continue;
      }
      if (value !== before) patch[field] = value;
    }

    if (draft.trackStock !== "") {
      const value = draft.trackStock === "true";
      if (value !== row.parsed.trackStock) patch.trackStock = value;
    }

    if (Object.keys(next).length > 0) {
      setIssues(next);
      return;
    }

    if (Object.keys(patch).length === 0) {
      setFormError("Nothing has changed on this row yet.");
      return;
    }

    const parsed = importRowPatchSchema.safeParse(patch);
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.length > 0 ? String(issue.path[0]) : "_";
        if (!(key in found)) found[key] = issue.message;
      }
      const { _: objectLevel, ...rest } = found;
      setIssues(rest);
      setFormError(objectLevel ?? null);
      return;
    }

    setIssues({});
    setFormError(null);
    mutation.mutate(
      { jobId, index: row.index, input: parsed.data },
      { onSuccess: close, onError: failed },
    );
  };

  const busy = mutation.isPending;
  const cellFor = (field: ProductImportField): string | undefined => {
    const header = columnMap[field];
    return header ? row.raw[header] : undefined;
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[620px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex flex-col gap-1">
            <Dialog.Title className="font-serif text-2xl leading-tight text-foreground">
              {/* `index` is 0-based over data rows, so the spreadsheet number is
                  index + 2 — the reviewer is looking at their own file. */}
              Row {spreadsheetRowNumber(row.index)}
            </Dialog.Title>
            <Dialog.Description className="text-[13px] text-muted-foreground">
              Change what this row will import as. Only the fields you edit are
              sent.
            </Dialog.Description>
          </div>

          {messages.length > 0 ? (
            <ul className="flex flex-col gap-2 rounded-[10px] border border-border bg-muted/50 px-3.5 py-3">
              {messages.map((message) => (
                <li key={message.key} className="flex flex-col gap-0.5">
                  <span
                    className={cn(
                      "text-[13px]",
                      message.tone === "problem"
                        ? "text-destructive-strong"
                        : "text-foreground",
                    )}
                  >
                    {message.text}
                  </span>
                  {/* The API's own words stay reachable for a support
                      conversation — never as the primary text. Its row numbers
                      are 0-based data indexes (contract Trap 6), which is why
                      the numbering is spelled out here. */}
                  {message.raw ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {message.raw}
                    </span>
                  ) : null}
                </li>
              ))}
              {messages.some((m) =>
                m.raw?.includes("Duplicated in the file"),
              ) ? (
                <li className="text-[11px] text-muted-foreground">
                  The row numbers in that message count from the first data row,
                  so add 2 for the spreadsheet line.
                </li>
              ) : null}
            </ul>
          ) : null}

          {row.status === "conflict" ? (
            <p className="rounded-[10px] border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning-strong">
              This row conflicts with a product you already stock. Saving an
              edit clears the decision made about it, and you will be asked
              again.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TEXT_FIELDS.map((field) => (
              <Field
                key={field}
                id={`${uid}-${field}`}
                field={field}
                cell={cellFor(field)}
                flagged={problems.has(field)}
                issue={issues[field]}
                className={
                  field === "description" ? "sm:col-span-2" : undefined
                }
              >
                <input
                  id={`${uid}-${field}`}
                  type="text"
                  value={draft[field]}
                  disabled={busy}
                  aria-invalid={issues[field] ? true : undefined}
                  onChange={(event) => set(field, event.target.value)}
                  className={CONTROL}
                />
              </Field>
            ))}

            {NUMBER_FIELDS.map((field) => (
              <Field
                key={field}
                id={`${uid}-${field}`}
                field={field}
                cell={cellFor(field)}
                flagged={problems.has(field)}
                issue={issues[field]}
              >
                <input
                  id={`${uid}-${field}`}
                  // `type="text"` with a decimal keypad, not `type="number"`:
                  // an empty number input yields NaN through `valueAsNumber`
                  // and zod fails the base type check before any bound runs.
                  type="text"
                  inputMode="decimal"
                  value={draft[field]}
                  disabled={busy}
                  aria-invalid={issues[field] ? true : undefined}
                  onChange={(event) => set(field, event.target.value)}
                  className={cn(CONTROL, "text-right font-mono")}
                />
              </Field>
            ))}

            <Field
              id={`${uid}-trackStock`}
              field="trackStock"
              cell={cellFor("trackStock")}
              flagged={problems.has("trackStock")}
              issue={issues.trackStock}
            >
              <select
                id={`${uid}-trackStock`}
                value={draft.trackStock}
                disabled={busy}
                onChange={(event) => set("trackStock", event.target.value)}
                className={CONTROL}
              >
                <option value="">Leave as it is</option>
                <option value="true">Yes — count this stock</option>
                <option value="false">No — a service or a fee</option>
              </select>
            </Field>
          </div>

          {formError ? (
            <p
              role="alert"
              className="rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong"
            >
              {formError}
            </p>
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
              disabled={busy}
              onClick={submit}
              className="h-10 rounded-[10px] px-4 font-semibold text-[13px]"
            >
              {busy ? "Saving…" : "Save row"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface FieldProps {
  id: string;
  field: ProductImportField;
  /** The reviewer's own cell, shown so they can see what the file said. */
  cell?: string;
  /** This field is one the server complained about. */
  flagged: boolean;
  issue?: string;
  className?: string;
  children: React.ReactNode;
}

function Field({
  id,
  field,
  cell,
  flagged,
  issue,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-[13px]">
          {importFieldLabel(field)}
        </Label>
        {flagged ? (
          <span className="font-mono text-[10px] tracking-[0.08em] text-destructive-strong uppercase">
            Needs a fix
          </span>
        ) : null}
      </div>
      {children}
      {issue ? (
        <p role="alert" className="text-[12px] text-destructive-strong">
          {issue}
        </p>
      ) : cell?.trim() ? (
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          File: {cell.trim()}
        </p>
      ) : null}
    </div>
  );
}
