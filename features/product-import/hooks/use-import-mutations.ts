"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { categoryKeys } from "@/features/categories/keys";
import { dashboardKeys } from "@/features/dashboard/keys";
import { productKeys } from "@/features/products/keys";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { importKeys } from "../keys";
import type {
  ColumnMapPatchInput,
  ImportRowPatchInput,
  ResolveConflictInput,
} from "../schemas/import.schema";
import * as importService from "../services/import.service";
import type {
  CommitImportResult,
  ImportJobDetail,
  ImportJobSummary,
  ImportRow,
} from "../types";

/**
 * The seven writes in this slice, and the cache work each one owes.
 *
 * **This file is mostly about invalidation, and that is on purpose** — more so
 * here than anywhere else in the app, because of one property of the endpoint
 * set that has no parallel elsewhere:
 *
 * > **A row write can change rows the caller never touched.** Every mutating
 * > service function re-runs `reconcileRows` over the *whole file*
 * > (`product-import.service.ts:189-192`) and recomputes `counts`. Fixing one
 * > half of a duplicate-barcode pair flips the other half from
 * > `needs_attention` to `ready` without anyone asking
 * > (`import.test.ts:281-291`). That partner row may be on a page nobody has
 * > open, under a status filter nobody selected.
 *
 * And the responses are no help: only `PATCH /columns` returns the job, and it
 * returns it **without rows**; the three row endpoints return the single row
 * they touched; the commit returns neither. So after every write, whatever the
 * caller is holding is stale in ways the response cannot describe.
 *
 * The answer is the same everywhere here: **invalidate the whole job, never
 * patch a page.** `importKeys.detail(jobId)` is a prefix of every page and
 * every status filter of that job (see `keys.ts`), so one call reaches all of
 * them. Nothing in this file calls `setQueryData` on a row or a page, and the
 * one `setQueryData` that does exist seeds a response that *is* a whole page.
 *
 * `importKeys.lists()` goes with it every time, because `publicJobSummary`
 * carries `counts` and `status` — so a job list row goes stale on every one of
 * these seven writes, not just the ones that create or cancel a job.
 *
 * None of these is optimistic. Every one can be refused by a rule only the
 * server can evaluate, and three of them (`IMPORT_NOT_READY` from the category
 * path, `IMPORT_CONFLICT_CHANGED`, and any remap) change server state in ways
 * the client cannot predict. A row that appears fixed and then reverts is worse
 * than a spinner on a screen whose whole subject is which rows are wrong.
 *
 * Nothing here renders an error either. A refusal belongs at the control the
 * user pressed — the row, the Commit button, the file picker — and a toast
 * fired from `onError` would consume it first.
 */

/** The arguments a remap needs. The hook takes none, so the job id rides along. */
export interface RemapColumnsVariables {
  jobId: ObjectId;
  input: ColumnMapPatchInput;
}

/** `index` is the row's own stable 0-based `index`, not a position in a page. */
export interface PatchRowVariables {
  jobId: ObjectId;
  index: number;
  input: ImportRowPatchInput;
}

/** Skipping takes no body — the row id is the whole request. */
export interface SkipRowVariables {
  jobId: ObjectId;
  index: number;
}

export interface ResolveConflictVariables {
  jobId: ObjectId;
  index: number;
  input: ResolveConflictInput;
}

/**
 * The invalidation every write in this slice owes: this job in full, and the
 * job list that shows its counts.
 *
 * Deliberately blunt. A narrower key would have to know which pages and which
 * status filters the reconciliation moved rows between, and that is exactly the
 * thing no response tells us.
 */
const useInvalidateJob = () => {
  const queryClient = useQueryClient();

  return (jobId: ObjectId) => {
    void queryClient.invalidateQueries({ queryKey: importKeys.detail(jobId) });
    void queryClient.invalidateQueries({ queryKey: importKeys.lists() });
  };
};

/**
 * `POST /products/import` — upload a file and get a job back.
 *
 * The response is the job **plus its first 20 rows at `status: "all"`**, which
 * is byte-for-byte what `GET /:id` answers with the default parameters — same
 * shaper, same slice, `page` and `limit` hard-coded to `1` and `20` in the
 * controller. So it is seeded rather than refetched, under
 * `importKeys.jobPage(id)` with the resolved defaults. A wizard that opens the
 * job with any other filter simply misses the seed and fetches, which is also
 * correct; nothing here can go stale, because the seed is the server's own
 * answer to that exact request.
 *
 * **There is no way to ask this call for more than 20 rows** — the two values
 * are literals in the controller, not query parameters. A 2,000-row import
 * needs a follow-up `useImportJob(id, { limit: 200, page: n })` loop of up to
 * ten calls; budget for it rather than assuming the create response is
 * complete.
 *
 * Refusals worth their own words on screen, all branched on `code`:
 * 413 `IMPORT_FILE_TOO_LARGE` (over 5 MB), 422 `IMPORT_NO_ROWS`,
 * `IMPORT_TOO_MANY_ROWS`, `IMPORT_UNSUPPORTED_FORMAT` or `VALIDATION_ERROR`,
 * and **429 `TOO_MANY_REQUESTS` — twenty uploads per 15 minutes across the
 * whole organization**, not per member, which is worth saying out loud because
 * a colleague's failed attempts spend the same budget. The 429 is already
 * surfaced as a toast by `lib/api/client`; the rest are not.
 *
 * `IMPORT_NO_ROWS` is the one to write carefully. It is what a `.xls`, a `.pdf`
 * and a `.txt` all produce, because there is no MIME allow-list and CSV is the
 * fall-through format — so "this file has no rows in it" is often the wrong
 * sentence, and "we could not read this file — save it as CSV or .xlsx" is the
 * right one.
 */
export function useUploadImport(): UseMutationResult<
  ImportJobDetail,
  ApiError,
  File
> {
  const queryClient = useQueryClient();

  return useMutation<ImportJobDetail, ApiError, File>({
    mutationFn: importService.createJob,
    onSuccess: (job) => {
      queryClient.setQueryData<ImportJobDetail>(
        importKeys.jobPage(job.id),
        job,
      );
      void queryClient.invalidateQueries({ queryKey: importKeys.lists() });
    },
  });
}

/**
 * `PATCH /products/import/:id/columns` — point a product field at a different
 * file column.
 *
 * **This is the most destructive call in the slice and it does not look like
 * it.** Every row that is not `skipped` has its `parsed`, `notes`, `errors` and
 * `status` re-derived from `raw`, and its `conflict` cleared
 * (`product-import.service.ts:355-363`) — so every manual row fix and every
 * conflict decision made so far is gone. The backend's own integration test has
 * to redo its edits afterwards. Put a confirmation in front of it.
 *
 * The response is the summary **with no rows**, so it is not seeded: the detail
 * cache holds a whole `ImportJobDetail`, and writing a summary into it would be
 * a shape that lies. The invalidation is what refreshes the rows, and it has to
 * be the whole job because every page of it just changed.
 *
 * Two refusals with the same 422 status and *different* codes, which is the
 * trap here: an unknown **file header**, or one header claimed by two fields,
 * is `IMPORT_UNKNOWN_HEADER`; an unknown **product field** key is a plain
 * `VALIDATION_ERROR` raised at the service layer. Branching only on
 * `IMPORT_UNKNOWN_HEADER` drops the second into the generic handler.
 * `columnMapPatchSchema` makes the second unreachable from typed code, which is
 * why it names the ten keys explicitly.
 */
export function useRemapImportColumns(): UseMutationResult<
  ImportJobSummary,
  ApiError,
  RemapColumnsVariables
> {
  const invalidateJob = useInvalidateJob();

  return useMutation<ImportJobSummary, ApiError, RemapColumnsVariables>({
    mutationFn: ({ jobId, input }) => importService.remapColumns(jobId, input),
    onSuccess: (_summary, { jobId }) => invalidateJob(jobId),
  });
}

/**
 * `PATCH /products/import/:id/rows/:index` — fix one row.
 *
 * **Send only the fields being changed.** The advice to echo `unit`,
 * `trackStock` and `quantity` defensively was written against a zod-defaults
 * leak that `Backend` commit `48c7205` fixed; echoing them now would overwrite
 * fields the user did not touch, which is the exact bug that fix removed.
 *
 * The response is the one row that was edited, and it is **not** written into
 * the cache. Two reasons, both fatal to a patch-in-place approach: the
 * file-wide reconciliation may have moved other rows, and `counts` — which the
 * reviewer's header renders — is recomputed server-side and not returned at
 * all.
 *
 * Editing a row in `conflict` **silently discards its resolution**. `editRow`
 * clears `conflict` before re-reconciling, and the reconcile pass re-creates it
 * with no `resolution` if the barcode still collides. Ask again after every
 * edit to a conflicted row; a Commit button that was enabled a moment ago will
 * correctly go back to blocked, and the user needs to know why.
 *
 * 404 `IMPORT_ROW_NOT_FOUND` for an index this job does not have, 409
 * `IMPORT_NOT_REVIEWING` once the job is committed or cancelled.
 */
export function usePatchImportRow(): UseMutationResult<
  ImportRow,
  ApiError,
  PatchRowVariables
> {
  const invalidateJob = useInvalidateJob();

  return useMutation<ImportRow, ApiError, PatchRowVariables>({
    mutationFn: ({ jobId, index, input }) =>
      importService.patchRow(jobId, index, input),
    onSuccess: (_row, { jobId }) => invalidateJob(jobId),
  });
}

/**
 * `DELETE /products/import/:id/rows/:index` — leave this row out of the import.
 *
 * Answers **200 with the row**, not a 204: the row is still in the file, now
 * `status: "skipped"` with its `errors` and `conflict` cleared, and it counts
 * towards `result.skipped` at commit.
 *
 * Skipping is what *unblocks* an import the user cannot fix — a row with a
 * price the file simply does not contain moves out of `needsAttention` and
 * stops holding the commit hostage. That makes it the natural pair to the
 * "needs attention" list, not a destructive action to hide.
 *
 * There is no restore endpoint. An "undo" is `usePatchImportRow` echoing one
 * real field from the row's own `parsed` — a `PATCH` re-validates and
 * reassigns `ready`/`needs_attention` unconditionally, which is what revives it.
 */
export function useSkipImportRow(): UseMutationResult<
  ImportRow,
  ApiError,
  SkipRowVariables
> {
  const invalidateJob = useInvalidateJob();

  return useMutation<ImportRow, ApiError, SkipRowVariables>({
    mutationFn: ({ jobId, index }) => importService.skipRow(jobId, index),
    onSuccess: (_row, { jobId }) => invalidateJob(jobId),
  });
}

/**
 * `POST /products/import/:id/rows/:index/resolve` — decide what happens to a
 * row whose barcode already belongs to a live product.
 *
 * **The row stays `status: "conflict"` afterwards.** Only
 * `conflict.resolution` changes, so `counts.conflict` does not move and a
 * screen watching it will look like nothing happened. The thing that changed is
 * per-row, which is why `commitReadiness` reads rows and not the summary.
 *
 * `"update"` also raises the bar for committing: the commit then needs
 * `products:update` as well as `products:create`, and refuses with a 403
 * *before the transaction opens* if the caller lacks it. Pass
 * `canUpdateProducts` to `commitReadiness` so that is caught here rather than
 * at the end of the wizard.
 *
 * 422 `IMPORT_ROW_NOT_CONFLICT` when the row is not currently in conflict —
 * which includes a row that was edited since the screen loaded, because editing
 * clears the conflict until the reconcile pass re-creates it.
 */
export function useResolveImportConflict(): UseMutationResult<
  ImportRow,
  ApiError,
  ResolveConflictVariables
> {
  const invalidateJob = useInvalidateJob();

  return useMutation<ImportRow, ApiError, ResolveConflictVariables>({
    mutationFn: ({ jobId, index, input }) =>
      importService.resolveConflict(jobId, index, input),
    onSuccess: (_row, { jobId }) => invalidateJob(jobId),
  });
}

/**
 * `POST /products/import/:id/commit` — write the products.
 *
 * The response is `{ result, productIds }` and **not** the job, so the job is
 * invalidated rather than seeded; a receipt screen re-reads `GET /:id` for
 * `status: "committed"` with `result` and `committedProductIds` on it. Read
 * those from the job while they last: the 7-day TTL is measured from the
 * **upload** and applies to committed jobs too, so the receipt outlives neither
 * the week nor the products it made.
 *
 * ### Why this invalidates four other features
 *
 *   - `productKeys.all` — the commit creates products and updates existing ones
 *     in one transaction, and writes stock movements for both (an `adjustment`
 *     for a new product with quantity, a `restock` or `adjustment` for a
 *     changed one). Which product ids moved is knowable from `productIds`, but
 *     which *lists*, *barcode lookups* and *movement pages* those ids appear on
 *     is not, so the whole prefix goes.
 *   - `categoryKeys.lists` — an unknown category name is created inside the
 *     same transaction, one per distinct normalised name, and the category list
 *     carries per-category product counts. (`categoryKeys` is the raw
 *     `createQueryKeys` result, so `lists` is an **array**, not a function.)
 *   - `dashboardKeys.all` — the Overview counts products and values stock.
 *
 * ### The two failures that change server state
 *
 * `IMPORT_NOT_READY` is **one code for two situations**, and one of them writes
 * before it throws: when a committing row names a category that does not exist
 * and the caller lacks `categories:create`, the service flags those rows
 * `needs_attention` with `errors.category`, recomputes `counts` and saves —
 * *then* raises the 422. It is the only refusal in the whole surface with a
 * write side effect. `IMPORT_CONFLICT_CHANGED` also writes: the transaction
 * rolls back completely (zero products, zero movements) and the racing row is
 * flipped back to `conflict` against the product that beat it, with no
 * resolution.
 *
 * So both codes get the same invalidation as a success. The other two refusals
 * — 409 `IMPORT_NOT_REVIEWING` and 403 `FORBIDDEN` for a missing
 * `products:update` — provably touch nothing, and re-fetching on them would
 * only cost a request. Branching on `code` rather than on status is what keeps
 * those two apart from the 422 and the 409 that do write.
 *
 * `countsFromNotReadyError` and `rowIndexFromConflictChangedError` read the
 * `details` each one carries, so the screen can say which row lost the race
 * without waiting for the refetch.
 */
export function useCommitImport(): UseMutationResult<
  CommitImportResult,
  ApiError,
  ObjectId
> {
  const queryClient = useQueryClient();
  const invalidateJob = useInvalidateJob();

  return useMutation<CommitImportResult, ApiError, ObjectId>({
    mutationFn: importService.commitJob,
    onSuccess: (_result, jobId) => {
      invalidateJob(jobId);
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      void queryClient.invalidateQueries({ queryKey: categoryKeys.lists });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
    onError: (error, jobId) => {
      if (
        error.code === API_ERROR_CODE.IMPORT_NOT_READY ||
        error.code === API_ERROR_CODE.IMPORT_CONFLICT_CHANGED
      ) {
        invalidateJob(jobId);
      }
    },
  });
}

/**
 * `DELETE /products/import/:id` — abandon the import.
 *
 * A **soft cancel**: 204 with no body, the job becomes `status: "cancelled"`,
 * and the document survives with all its rows until its TTL fires. It keeps
 * appearing in `useImportJobs`, which is why the list is invalidated rather
 * than having the row removed — there is no delete anywhere in this API, and
 * a UI that makes the row vanish is describing something that did not happen.
 *
 * Nothing was written, so no product, category or dashboard key is touched.
 *
 * 409 `IMPORT_NOT_REVIEWING` if the job was already committed or cancelled —
 * the same code the mutating endpoints raise, and here it usually means a
 * second tab got there first.
 */
export function useCancelImport(): UseMutationResult<void, ApiError, ObjectId> {
  const invalidateJob = useInvalidateJob();

  return useMutation<void, ApiError, ObjectId>({
    mutationFn: importService.cancelJob,
    onSuccess: (_void, jobId) => invalidateJob(jobId),
  });
}
