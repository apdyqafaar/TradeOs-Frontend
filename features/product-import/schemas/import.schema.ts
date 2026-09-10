import { z } from "zod";
import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";
import type {
  ImportCounts,
  ImportJobStatus,
  ImportJobSummary,
  ImportRow,
  ProductImportField,
} from "../types";

/**
 * MIRROR OF `../Backend/src/validators/product-import.validation.ts` and the
 * row shape it builds from, `../Backend/src/services/import/clean.ts:14-20`
 * (which is `createProductSchema` minus `images` and the form's `categoryId`,
 * plus the file's `category` NAME and a resolved `categoryId`).
 *
 * Every bound below is copied from those files, cross-checked against
 * `docs/contracts/product-import.md`. This schema is not the authority — the
 * API validates again and answers a 422 whose `errors` map `fieldErrorsFor`
 * feeds into `setError`. When a backend validator changes, change this file in
 * the same commit.
 *
 * `strictObject` throughout, matching every one of these bodies being
 * `.strict()`: an unknown key is a 422 there, so it is a parse failure here
 * rather than a field that vanishes silently.
 *
 * ### This file also holds the derived answers, not just the schemas
 *
 * `commitReadiness`, `spreadsheetRowNumber` and the two `details` readers below
 * are not zod schemas, and they live here for the same reason
 * `dueDateFromCalendarDate` and `remainingFromPaymentError` live in
 * `features/debts/schemas/debt.schema.ts`: they are the small pieces of
 * *judgement* that every screen in the slice would otherwise re-derive, and
 * getting one of them wrong is a control that lies. They belong next to a test
 * file.
 */

/* ------------------------------------------------------------------------ */
/* Shared field rules                                                        */
/* ------------------------------------------------------------------------ */

/**
 * `MAX_MONEY` and `MAX_QUANTITY` from `../Backend/src/lib/money.ts:12,15`,
 * mirrored rather than approximated: a value this accepts and the API rejects
 * is the failure this file exists to prevent.
 */
const MAX_MONEY = 1e12;
const MAX_QUANTITY = 1e9;

/**
 * `isMoney` and `isQuantity`, transcribed (`money.ts:34-39`, `41-47`). The
 * decimal test is `|n * 10^d - round(n * 10^d)| < 1e-6` rather than a
 * `multipleOf`, because binary floats make the modulo test reject honest values
 * (`8.29 % 0.01` is not 0). Refuse rather than round: rounding hides the bug
 * that produced the extra digits, and the server refuses it anyway.
 */
const isMoney = (value: number): boolean =>
  Number.isFinite(value) &&
  value >= 0 &&
  value <= MAX_MONEY &&
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

const isQuantity = (value: number): boolean =>
  Number.isFinite(value) &&
  value > 0 &&
  value <= MAX_QUANTITY &&
  Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6;

/**
 * The `error` on `z.number()` itself is load-bearing: an empty
 * `<input type="number">` registered with `valueAsNumber` yields `NaN`, and zod
 * fails the base type check before any refinement runs — without it the person
 * fixing a row reads "expected number, received NaN".
 */
const money = (label: string) =>
  z
    .number({ error: `${label} is required` })
    .refine(isMoney, `${label} must be 0 or more, with at most 2 decimals`);

/* ------------------------------------------------------------------------ */
/* PATCH /products/import/:id/columns                                        */
/* ------------------------------------------------------------------------ */

/**
 * One entry of the column map: a file header, or `null` to unmap the field.
 *
 * `null` is always legal (`product-import.service.ts:315-316,320`) and is the
 * only way to free a header for another field. The 1..200 bounds are the
 * backend's (`product-import.validation.ts:36`); the `.trim()` is ours, because
 * the headers this is matched against were themselves trimmed at parse time
 * (`../Backend/src/services/import/parse.ts:64-83`), so an untrimmed value
 * could only ever produce a spurious `IMPORT_UNKNOWN_HEADER`.
 */
const columnMapEntry = z
  .string()
  .trim()
  .min(1, "Pick a column, or clear this field")
  .max(200, "That column name is too long")
  .nullable();

/**
 * The ten fields, each optional. `satisfies` pins the shape to
 * `ProductImportField` so a field added to `PRODUCT_IMPORT_FIELDS` and
 * forgotten here is a compile error rather than a 422 at runtime.
 *
 * Deliberately **stricter than the wire schema**, which is a loose
 * `z.record(z.string(), …)`. The real gate is one layer further in: the service
 * rejects a key that is not a `ProductField` with a 422 whose code is the
 * default `VALIDATION_ERROR` — **not** `IMPORT_UNKNOWN_HEADER`
 * (`product-import.service.ts:298-302`, Trap 8). Naming the ten keys here turns
 * that runtime surprise into a typo the compiler catches.
 */
const columnMapShape = {
  name: columnMapEntry.optional(),
  barcode: columnMapEntry.optional(),
  category: columnMapEntry.optional(),
  unit: columnMapEntry.optional(),
  costPrice: columnMapEntry.optional(),
  sellingPrice: columnMapEntry.optional(),
  quantity: columnMapEntry.optional(),
  lowStockThreshold: columnMapEntry.optional(),
  trackStock: columnMapEntry.optional(),
  description: columnMapEntry.optional(),
} satisfies Record<ProductImportField, unknown>;

/**
 * `PATCH /products/import/:id/columns` — `products:create`.
 *
 * **A partial merge, not a replacement**: the service applies
 * `{ ...job.columnMap, ...patch }` (`product-import.service.ts:304`), so send
 * only the fields being changed. An empty `columnMap` is a 422 on the backend's
 * own refine, mirrored here.
 *
 * The **merged** map is what gets validated, not the patch, and there are two
 * refusals this cannot pre-check because neither is knowable from the patch
 * alone — both 422 `IMPORT_UNKNOWN_HEADER`:
 *
 *   - a header that is not one of the file's own headers, keyed in `errors` by
 *     the **product field**;
 *   - one header claimed by two fields in the merged map, keyed in `errors` by
 *     the literal string `"columnMap"`.
 *
 * So one endpoint answers three different `errors` shapes. Nothing is written
 * unless every check passes.
 *
 * Two things a caller must do around this, neither of which a schema can
 * enforce. **Moving a header between fields has to happen in one call** —
 * `{ costPrice: null, sellingPrice: "Cost" }` succeeds where
 * `{ sellingPrice: "Cost" }` alone is refused. And **a remap destroys every
 * manual row edit**: the service re-derives `parsed`, `notes`, `errors`,
 * `status` and clears `conflict` for every row that is not `skipped`
 * (`product-import.service.ts:355-363`). Warn before sending this.
 */
export const columnMapPatchSchema = z.strictObject({
  columnMap: z
    .strictObject(columnMapShape)
    .refine(
      (map) => Object.keys(map).length > 0,
      "Choose at least one column to change",
    ),
});

/* ------------------------------------------------------------------------ */
/* PATCH /products/import/:id/rows/:index                                    */
/* ------------------------------------------------------------------------ */

/**
 * The ten editable fields of one staged row.
 *
 * **`categoryId` and `images` are not here and must not be** — both are
 * `unrecognized_keys` 422s (`importRowPatchSchema` omits `categoryId` and
 * `importRowSchema` omits `images`). The category is changed by sending its
 * **name** in `category`, and `""` is the way to clear it: `category` carries
 * no `.min()` (`clean.ts:17`), and `resolveRowCategories` then deletes both
 * `parsed.category` and `parsed.categoryId` because the trimmed name is falsy.
 *
 * `barcode`'s minimum length is **4** and its charset excludes spaces
 * (`product.validation.ts:15-20`) — a 3-character SKU is `needs_attention`, and
 * that is easy to miss when a real shop's codes are short.
 */
const importRowPatchShape = {
  name: z
    .string()
    .trim()
    .min(1, "A product needs a name")
    .max(120, "That name is too long")
    .optional(),
  barcode: z
    .string()
    .trim()
    .min(4, "A barcode needs at least 4 characters")
    .max(64, "That barcode is too long")
    .regex(
      /^[A-Za-z0-9._-]+$/,
      "A barcode may only hold letters, numbers, dots, dashes and underscores",
    )
    .optional(),
  /** Blank clears the category; the product then falls back to **General**. */
  category: z
    .string()
    .trim()
    .max(60, "That category name is too long")
    .optional(),
  unit: z
    .string()
    .trim()
    .min(1, "Say what this is sold by")
    .max(20, "That unit is too long")
    .optional(),
  costPrice: money("Cost price").optional(),
  sellingPrice: money("Selling price").optional(),
  quantity: z
    .number({ error: "Quantity is required" })
    .refine(
      (value) => value === 0 || isQuantity(value),
      "Quantity must be 0 or more, with at most 3 decimals",
    )
    .optional(),
  lowStockThreshold: z
    .number({ error: "Low stock must be a number" })
    .int("Low stock must be a whole number")
    .min(0, "Low stock cannot be negative")
    .max(1e9, "That low-stock level is too high")
    .optional(),
  trackStock: z.boolean().optional(),
  description: z
    .string()
    .trim()
    .max(2000, "That description is too long")
    .optional(),
} satisfies Record<ProductImportField, unknown>;

/**
 * `PATCH /products/import/:id/rows/:index` — `products:create`.
 *
 * **Send only the fields being changed.** The old advice — echo the row's
 * current `unit`, `trackStock` and `quantity` on every call — was written
 * against a real defect and is now **stale**: `importRowPatchSchema` inherited
 * `createProductSchema`'s `.default()`s through `.partial()` (zod 4 applies a
 * default to a genuinely missing key even under `.partial()`), so
 * `PATCH { sellingPrice: 12 }` arrived at the service as
 * `{ sellingPrice: 12, unit: "pcs", trackStock: true, quantity: 0 }` and
 * clobbered three fields nobody touched. `Backend` commit `48c7205` re-declared
 * those three without their defaults
 * (`product-import.validation.ts:64-76`), and re-running the contract's own
 * §11 check against this repo now returns `{"sellingPrice":12}` and nothing
 * else. Echoing them defensively today would *reintroduce* the bug on a row the
 * user did not mean to touch.
 *
 * The same fix un-vacuous-ed the `"Nothing to update"` refine, so an empty body
 * is now a genuine 422 rather than a destructive 200. It is mirrored here so
 * the request is never sent at all. Note the shape of that 422: the issue has
 * an empty zod path, and `zodToFieldErrors` keys an empty path as **`"_"`**
 * (`../Backend/src/middleware/error.middleware.ts:9-16`), so it arrives as
 * `errors: { _: "Nothing to update" }` — not under a field name.
 *
 * Two consequences of the endpoint's behaviour that no schema can express:
 *
 *   - **the whole file is re-reconciled**, so this can flip rows the caller
 *     never touched (fixing one duplicate barcode frees its partner) and it
 *     recomputes `counts` — none of which comes back in the response;
 *   - **any resolution on a conflicted row is silently discarded**, because
 *     `editRow` clears `conflict` before re-reconciling and the reconcile pass
 *     re-creates it with no `resolution`. Re-ask the user after every edit to a
 *     conflicted row.
 *
 * This is also the only way to un-skip a row: there is no restore endpoint, and
 * a `PATCH` re-validates and reassigns `ready`/`needs_attention`
 * unconditionally (Trap 9). Echoing one real field from the row's own `parsed`
 * is enough now that the defaults no longer leak.
 */
export const importRowPatchSchema = z
  .strictObject(importRowPatchShape)
  .refine((patch) => Object.keys(patch).length > 0, "Nothing to update");

/* ------------------------------------------------------------------------ */
/* POST /products/import/:id/rows/:index/resolve                             */
/* ------------------------------------------------------------------------ */

/**
 * `POST /products/import/:id/rows/:index/resolve` — `products:create`.
 *
 * **Exactly two options, no default, and `resolution` is required.** There is
 * no `"create"`, `"replace"` or `"ignore"`, and no way to create a second
 * product with the same barcode — the unique index would refuse it anyway.
 *
 * `"update"` patches the existing product at commit with the row's **non-blank**
 * fields only (a blank cell never blanks a live product) and writes one stock
 * movement for any quantity difference. `"skip"` leaves the product alone and
 * counts the row in `result.skipped`.
 *
 * Refused with 422 `IMPORT_ROW_NOT_CONFLICT` when the row's status is not
 * `conflict` — which includes a row the user just edited, since editing clears
 * the conflict until the reconcile pass re-creates it.
 */
export const resolveConflictSchema = z.strictObject({
  resolution: z.enum(["skip", "update"], {
    error: "Choose whether to update the existing product or skip this row",
  }),
});

export type ColumnMapPatchInput = z.infer<typeof columnMapPatchSchema>;
export type ImportRowPatchInput = z.infer<typeof importRowPatchSchema>;
export type ResolveConflictInput = z.infer<typeof resolveConflictSchema>;

/* ------------------------------------------------------------------------ */
/* Can this job be committed?                                                */
/* ------------------------------------------------------------------------ */

/**
 * Why a commit would be refused. Machine-readable so the copy stays in the
 * component that shows it — a data layer that writes sentences ends up owning
 * the tone of every screen that imports it.
 */
export type CommitBlocker =
  /** 409 `IMPORT_NOT_REVIEWING`. The job was already committed or cancelled. */
  | { reason: "not_reviewing"; status: ImportJobStatus }
  /** 422 `IMPORT_NOT_READY`. Rows still carry validation errors. */
  | { reason: "needs_attention"; count: number }
  /**
   * Not a server refusal — the client cannot yet *answer*. See the note on
   * `commitReadiness` about why the summary alone is not enough.
   */
  | { reason: "conflicts_not_loaded"; loaded: number; expected: number }
  /** 422 `IMPORT_NOT_READY`. A conflicted row has no decision on it. */
  | { reason: "unresolved_conflict"; rowIndexes: number[] }
  /** 403 `FORBIDDEN`. Rows resolved `"update"` need `products:update` too. */
  | { reason: "missing_products_update"; rowIndexes: number[] };

export type CommitBlockReason = CommitBlocker["reason"];

export interface CommitReadiness {
  /** True only when the server's own gate would pass **and** we can prove it. */
  canCommit: boolean;
  /** `null` when `canCommit`. The first thing standing in the way otherwise. */
  blocker: CommitBlocker | null;
  /** Conflicted rows still awaiting a decision, ascending. */
  unresolvedConflictIndexes: number[];
  /** Conflicted rows resolved `"update"`, ascending. */
  updateRowIndexes: number[];
  /**
   * Advisory, **not** a blocker: the gate passes but the commit would write
   * nothing (every row skipped, or resolved `"skip"`). The server accepts this
   * happily and marks the job `committed` — irreversibly, since there is no way
   * back out of that status. Worth a confirmation; not worth a disabled button,
   * because disabling a control the server would accept is its own kind of lie.
   * `false` whenever the answer is unknown.
   */
  commitsNothing: boolean;
}

export interface CommitReadinessInput {
  /** The job summary — `status` and `counts` are all that is read. */
  job: Pick<ImportJobSummary, "status" | "counts">;
  /**
   * Whatever rows the client is holding. A mixed page is fine; this filters to
   * the conflicted ones itself and de-duplicates by `index`, so accumulated
   * pages can be passed straight in.
   */
  rows: readonly Pick<ImportRow, "index" | "status" | "conflict">[];
  /**
   * Whether the caller holds `products:update` — from
   * `useCan(PERMISSIONS.PRODUCTS_UPDATE)`. Omit it and that refusal is simply
   * not predicted, which is the honest default when the session is still
   * loading.
   */
  canUpdateProducts?: boolean;
}

/** The slice of a row `commitReadiness` reads. Named so the map below can be typed. */
type ImportReadinessRow = CommitReadinessInput["rows"][number];

/**
 * The one question every screen in this slice asks, answered the way the server
 * answers it.
 *
 * ### Why the obvious test is wrong
 *
 * `counts.conflict === 0` never becomes true. Resolving a conflict writes
 * `conflict.resolution` and **leaves `status: "conflict"`**
 * (`product-import.service.ts:434`, asserted at `import.test.ts:305-307`), so
 * the tally does not move however many decisions the user makes. A button
 * gated on it stays disabled forever; a banner gated on it accuses a reviewer
 * who has already done the work.
 *
 * The condition the server actually evaluates is
 * `counts.needsAttention > 0 || conflictRows.some(r => !r.conflict?.resolution)`
 * (`product-import.service.ts:489-501`) — and the second half needs **per-row**
 * data that `publicJobSummary` does not carry. That is the real shape of the
 * problem: the summary can prove a "no" (any `needsAttention` is fatal) but it
 * can never prove a "yes". So this refuses to guess, and says
 * `conflicts_not_loaded` when it is holding fewer conflicted rows than
 * `counts.conflict` claims exist — a state a caller renders as "checking",
 * never as "fix your rows". Fetch them with
 * `useImportJob(id, { status: "conflict", limit: 200 })`.
 *
 * Rows are matched on `status === "conflict"` rather than on the presence of a
 * `conflict` object, because a cleared conflict may or may not actually be gone
 * from the stored document — the contract marks that unverified (§14) and says
 * to key off `status`.
 *
 * ### What it deliberately does not predict
 *
 * The commit's **fourth** refusal — a row naming a category that does not exist
 * when the caller lacks `categories:create` — is also a 422 `IMPORT_NOT_READY`,
 * and it is not predictable from anything on the wire. The only client-side
 * signal is the wording of a row `note`, and branching on a message is exactly
 * what this codebase does not do. Handle it after the fact, and **re-fetch the
 * job when it happens**: that refusal is the one write-side-effect in the whole
 * surface — it flags the offending rows `needs_attention`, recomputes `counts`
 * and saves, all before throwing.
 */
export function commitReadiness({
  job,
  rows,
  canUpdateProducts,
}: CommitReadinessInput): CommitReadiness {
  const conflicts = new Map<number, ImportReadinessRow>();
  for (const row of rows) {
    if (row.status === "conflict") conflicts.set(row.index, row);
  }

  const held = [...conflicts.values()].sort((a, b) => a.index - b.index);
  const unresolvedConflictIndexes = held
    .filter((row) => !row.conflict?.resolution)
    .map((row) => row.index);
  const updateRowIndexes = held
    .filter((row) => row.conflict?.resolution === "update")
    .map((row) => row.index);

  const loaded = conflicts.size;
  const expected = job.counts.conflict;
  // `>=` rather than `===`: `counts` can lag the rows in hand (it is recomputed
  // server-side on every write but only two endpoints return it), and holding
  // more conflicted rows than the tally admits to is not a reason to refuse an
  // answer.
  const conflictsLoaded = loaded >= expected;

  const commitsNothing =
    conflictsLoaded && job.counts.ready === 0 && updateRowIndexes.length === 0;

  const refuse = (blocker: CommitBlocker): CommitReadiness => ({
    canCommit: false,
    blocker,
    unresolvedConflictIndexes,
    updateRowIndexes,
    commitsNothing,
  });

  // Ordered so the most useful sentence wins. The server checks status first
  // and this mirrors it; `needs_attention` is checked before the rows are
  // demanded because the summary alone already settles that "no", and making
  // someone wait on a fetch to be told what the header already says is worse
  // than a slightly different order from the backend's.
  if (job.status !== "reviewing")
    return refuse({ reason: "not_reviewing", status: job.status });

  if (job.counts.needsAttention > 0)
    return refuse({
      reason: "needs_attention",
      count: job.counts.needsAttention,
    });

  if (!conflictsLoaded)
    return refuse({ reason: "conflicts_not_loaded", loaded, expected });

  if (unresolvedConflictIndexes.length > 0)
    return refuse({
      reason: "unresolved_conflict",
      rowIndexes: unresolvedConflictIndexes,
    });

  if (canUpdateProducts === false && updateRowIndexes.length > 0)
    return refuse({
      reason: "missing_products_update",
      rowIndexes: updateRowIndexes,
    });

  return {
    canCommit: true,
    blocker: null,
    unresolvedConflictIndexes,
    updateRowIndexes,
    commitsNothing,
  };
}

/* ------------------------------------------------------------------------ */
/* Reading the two `details` payloads, and the row number a person sees      */
/* ------------------------------------------------------------------------ */

/**
 * The spreadsheet row number for a 0-based `ImportRow.index`.
 *
 * `index` counts **data** rows and row 1 of the file is always the header, so
 * the offset is 2. This matters because the server's own duplicate-barcode
 * message quotes raw indexes — `"Duplicated in the file (rows 3, 4)"` means the
 * spreadsheet's rows 5 and 6 (Trap 6). That message cannot be rewritten from
 * here without string-matching it, so a screen showing it verbatim should say
 * elsewhere which numbering it uses, and every row number the UI produces
 * itself should come through this.
 */
export const spreadsheetRowNumber = (index: number): number => index + 2;

/**
 * The server's fresh `counts` off a refused commit.
 *
 * `IMPORT_NOT_READY` carries `details: { counts }`
 * (`product-import.service.ts:494-501`, `537-542`), which is the only reason to
 * read it: one of the two paths that raise this code **writes to the job before
 * throwing**, so these counts can differ from the ones the screen was showing.
 * Treat them as a preview and re-fetch the job regardless — the rows changed
 * too, and `details` does not carry those.
 */
export function countsFromNotReadyError(
  error: unknown,
): ImportCounts | undefined {
  if (!isApiError(error)) return undefined;
  if (error.code !== API_ERROR_CODE.IMPORT_NOT_READY) return undefined;

  const counts = error.details?.counts;
  if (typeof counts !== "object" || counts === null) return undefined;

  const { ready, needsAttention, conflict, skipped } = counts as Record<
    string,
    unknown
  >;
  if (
    typeof ready !== "number" ||
    typeof needsAttention !== "number" ||
    typeof conflict !== "number" ||
    typeof skipped !== "number"
  ) {
    return undefined;
  }

  return { ready, needsAttention, conflict, skipped };
}

/**
 * Which row lost the barcode race, off a 409 `IMPORT_CONFLICT_CHANGED`.
 *
 * Someone created a product with this row's barcode while the import was being
 * reviewed. The whole transaction rolled back — zero products written, zero
 * stock movements — the job is still `reviewing`, and the named row has been
 * flipped back to `conflict` against the **now-current** product with no
 * resolution on it (`product-import.service.ts:622-649`). So the honest
 * response is to re-fetch, take the user to this row and ask again.
 */
export function rowIndexFromConflictChangedError(
  error: unknown,
): number | undefined {
  if (!isApiError(error)) return undefined;
  if (error.code !== API_ERROR_CODE.IMPORT_CONFLICT_CHANGED) return undefined;

  const rowIndex = error.details?.rowIndex;
  return typeof rowIndex === "number" ? rowIndex : undefined;
}
