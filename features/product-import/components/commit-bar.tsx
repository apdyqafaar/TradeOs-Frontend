"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCan } from "@/features/auth/hooks/use-permission";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { useImportJobConflicts } from "../hooks/use-import-job";
import { useCommitImport } from "../hooks/use-import-mutations";
import {
  type CommitBlocker,
  commitReadiness,
  countsFromNotReadyError,
  rowIndexFromConflictChangedError,
  spreadsheetRowNumber,
} from "../schemas/import.schema";
import type { ImportCounts, ImportJobSummary, ImportRow } from "../types";

export interface CommitBarProps {
  jobId: ObjectId;
  /** The job as the wizard fetched it. `status`, `counts` and `result` are read. */
  job: ImportJobSummary;
}

/**
 * Step 4 of artboard `2e` — the summary bar and the button that writes the
 * products (`docs/design/TradeOs-UI.dc.html:808-816`).
 *
 * ### The summary can prove a "no" but never a "yes"
 *
 * The server's gate is
 * `counts.needsAttention > 0 || conflictRows.some(r => !r.conflict?.resolution)`
 * (`product-import.service.ts:489-501`). The first half is answerable from
 * `counts` alone; the second needs **per-row** `conflict.resolution`, which
 * `publicJobSummary` does not carry at all. And `counts.conflict` is not in the
 * gate and cannot be — resolving a conflict writes `conflict.resolution` and
 * leaves `status: "conflict"`, so that tally never falls however many decisions
 * the reviewer makes. A button gated on `counts.conflict === 0` is disabled
 * for ever; a banner gated on it accuses someone who has already done the work.
 *
 * So this asks `commitReadiness` and does not re-derive any of it. When it
 * answers `conflicts_not_loaded` the bar says **checking** — never "fix your
 * rows" — because that blocker means the client cannot yet answer, not that the
 * answer is no.
 *
 * ### Two refusals write to the job before they throw
 *
 * 422 `IMPORT_NOT_READY` from the category path re-flags rows
 * `needs_attention`, recomputes `counts` and saves *before* raising; 409
 * `IMPORT_CONFLICT_CHANGED` rolls the whole transaction back and flips the
 * racing row to `conflict` with no resolution. `useCommitImport` invalidates
 * the job on exactly those two codes and on nothing else, so what is on screen
 * a moment later is the server's new truth rather than the one the user was
 * looking at. The bar reads the fresh `counts` off the 422's own `details` so
 * it can say what changed without waiting for the refetch.
 */
export function CommitBar({ jobId, job }: CommitBarProps) {
  const canUpdateProducts = useCan(PERMISSIONS.PRODUCTS_UPDATE);
  const conflicts = useAllConflictRows(jobId, job.updatedAt);
  const commit = useCommitImport();

  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<{
    text: string;
    counts?: ImportCounts;
  } | null>(null);

  const readiness = commitReadiness({
    job,
    rows: conflicts.rows,
    // Omitted while the session is still loading, because `commitReadiness`
    // predicts nothing from `undefined` — which is the honest default. `useCan`
    // returns `false` for "loading" and for "denied" alike, so the distinction
    // has to be made here.
    canUpdateProducts: conflicts.isLoading ? undefined : canUpdateProducts,
  });

  const resolved = conflicts.rows.filter(
    (row) => row.conflict?.resolution !== undefined,
  ).length;

  const failed = (error: ApiError) => {
    // Branch on `code`, never on `message` (CLAUDE.md).
    if (error.code === API_ERROR_CODE.IMPORT_CONFLICT_CHANGED) {
      const index = rowIndexFromConflictChangedError(error);
      setRefusal({
        text:
          index === undefined
            ? "A barcode in this file was claimed by a product created while you were reviewing. Nothing was imported — every change was rolled back. Check the conflicts again."
            : `Row ${spreadsheetRowNumber(index)}'s barcode was claimed by a product created while you were reviewing. Nothing was imported — every change was rolled back, and that row is waiting for a fresh decision.`,
      });
      return;
    }

    if (error.code === API_ERROR_CODE.IMPORT_NOT_READY) {
      setRefusal({
        text: "Some rows still need attention. The import was re-checked just now and the numbers above have been refreshed.",
        // `details.counts` is the server's own tally *after* the re-check —
        // worth showing straight away, because one of the two paths that raise
        // this code writes before it throws.
        counts: countsFromNotReadyError(error),
      });
      return;
    }

    if (error.code === API_ERROR_CODE.IMPORT_NOT_REVIEWING) {
      setRefusal({
        text: "This import has already been committed or cancelled — someone else may have finished it.",
      });
      return;
    }

    if (error.status === 403) {
      setRefusal({
        text: "Some rows are set to update a product you already stock, and you do not have permission to change products. Ask an owner, or set those rows to Skip.",
      });
      return;
    }

    setRefusal({ text: error.message });
  };

  const run = () => {
    setRefusal(null);
    setConfirming(false);
    commit.mutate(jobId, {
      onError: failed,
    });
  };

  const press = () => {
    // A commit that writes nothing is legal and the server takes it — every row
    // skipped is `{ created: 0, updated: 0, skipped: N }` and the job is marked
    // `committed`, irreversibly. Disabling a control the server would accept is
    // its own kind of lie, so it is a confirmation rather than a blocked button
    // (`docs/findings/slice4-import-data.md` §3).
    if (readiness.commitsNothing) {
      setConfirming(true);
      return;
    }
    run();
  };

  // A committed job is a receipt. Note it does not outlive the week: the TTL is
  // absolute at 7 days from the **upload**, and committing does not exempt it.
  if (job.status === "committed" && job.result) {
    return (
      <Bar>
        <div className="flex flex-col gap-1.5">
          <Heading />
          <p className="text-[14px] text-foreground">
            <Figure>{job.result.created}</Figure> created ·{" "}
            <Figure>{job.result.updated}</Figure> updated ·{" "}
            <Figure>{job.result.skipped}</Figure> skipped
          </p>
          <p className="text-[12px] text-muted-foreground">
            This import is finished. The products it made stay in your
            catalogue; this record of it is kept for a few days only.
          </p>
        </div>
      </Bar>
    );
  }

  if (job.status === "cancelled") {
    return (
      <Bar>
        <div className="flex flex-col gap-1.5">
          <Heading />
          <p className="text-[14px] text-foreground">
            This import was cancelled. Nothing was written.
          </p>
        </div>
      </Bar>
    );
  }

  const checking = readiness.blocker?.reason === "conflicts_not_loaded";
  const counts = refusal?.counts ?? job.counts;

  return (
    <>
      <Bar>
        <div className="flex flex-col gap-1.5">
          <Heading />

          {/* The canvas's line, with the third segment only when this file has
              conflicts at all — "0 conflicts resolved" on a clean file is a
              number about nothing. */}
          <p className="text-[14px] text-foreground">
            <Figure>{counts.ready}</Figure> ready ·{" "}
            <Figure>{counts.skipped}</Figure> skipped
            {counts.conflict > 0 ? (
              <>
                {" · "}
                <Figure>{checking ? "…" : resolved}</Figure> of{" "}
                <Figure>{counts.conflict}</Figure> conflicts resolved
              </>
            ) : null}
          </p>

          {readiness.updateRowIndexes.length > 0 ? (
            <p className="text-[12px] text-muted-foreground">
              {readiness.updateRowIndexes.length === 1
                ? "1 row will change a product you already stock."
                : `${readiness.updateRowIndexes.length} rows will change products you already stock.`}
            </p>
          ) : null}

          {readiness.blocker ? (
            <p className="text-[12px] text-warning-strong">
              {blockerText(readiness.blocker)}
            </p>
          ) : readiness.commitsNothing ? (
            <p className="text-[12px] text-muted-foreground">
              Nothing in this file will be written — every row is skipped or set
              to leave the existing product alone.
            </p>
          ) : null}

          {conflicts.error ? (
            <p role="alert" className="text-[12px] text-destructive-strong">
              The conflicts could not be read, so this import cannot be checked:{" "}
              {conflicts.error.message}
              {conflicts.error.requestId ? (
                <span className="font-mono">
                  {" "}
                  ({conflicts.error.requestId})
                </span>
              ) : null}
            </p>
          ) : null}

          {refusal ? (
            <p role="alert" className="text-[12px] text-destructive-strong">
              {refusal.text}
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          disabled={!readiness.canCommit || commit.isPending}
          onClick={press}
          className="h-11 flex-none rounded-[10px] px-5 font-semibold text-[14px]"
        >
          {commit.isPending
            ? "Importing…"
            : checking
              ? "Checking…"
              : `Import ${counts.ready} product${counts.ready === 1 ? "" : "s"}`}
        </Button>
      </Bar>

      <Dialog.Root open={confirming} onOpenChange={setConfirming}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[460px] flex-col gap-4 rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
            <Dialog.Title className="font-serif text-2xl leading-tight text-foreground">
              Finish an import that writes nothing?
            </Dialog.Title>
            <Dialog.Description className="text-[13px] text-muted-foreground">
              Every row is skipped or set to leave the existing product alone,
              so no product will be created or changed. The file will be marked
              as imported and cannot be reopened.
            </Dialog.Description>
            <div className="flex justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
                className="h-10 rounded-[10px] px-4 text-[13px]"
              >
                Keep reviewing
              </Button>
              <Button
                type="button"
                onClick={run}
                className="h-10 rounded-[10px] px-4 font-semibold text-[13px]"
              >
                Finish anyway
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* The blocker, in words                                                     */
/* ------------------------------------------------------------------------ */

/**
 * The copy lives here rather than in `commitReadiness`, which returns machine
 * -readable blockers on purpose: a data layer that writes sentences ends up
 * owning the tone of every screen that imports it.
 */
export function blockerText(blocker: CommitBlocker): string {
  switch (blocker.reason) {
    case "not_reviewing":
      return blocker.status === "committed"
        ? "This import has already been run."
        : "This import was cancelled, so nothing more can be done with it.";

    case "needs_attention":
      // The canvas's own sentence.
      return `${blocker.count} row${blocker.count === 1 ? "" : "s"} still need${
        blocker.count === 1 ? "s" : ""
      } attention — fix or skip them to enable the import.`;

    case "conflicts_not_loaded":
      // NOT "fix your rows". The client cannot answer yet; the answer may well
      // be yes.
      return `Checking the conflicts — ${blocker.loaded} of ${blocker.expected} read so far.`;

    case "unresolved_conflict": {
      const n = blocker.rowIndexes.length;
      const rows = blocker.rowIndexes
        .slice(0, 4)
        .map(spreadsheetRowNumber)
        .join(", ");
      const more = n > 4 ? ` and ${n - 4} more` : "";
      return `${n} row${n === 1 ? "" : "s"} clash with products you already stock and need a decision — row${n === 1 ? "" : "s"} ${rows}${more}. Choose Skip or Update existing on each.`;
    }

    case "missing_products_update": {
      const n = blocker.rowIndexes.length;
      return `${n} row${n === 1 ? " is" : "s are"} set to update a product you already stock, and you do not have permission to change products. Ask an owner, or set ${n === 1 ? "it" : "them"} to Skip.`;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Holding every conflicted row                                              */
/* ------------------------------------------------------------------------ */

interface AllConflictRows {
  rows: ImportRow[];
  /** True until every page of conflicts has been read, or one has failed. */
  isLoading: boolean;
  error: ApiError | null;
}

/**
 * Every conflicted row of the job, paged in at the endpoint's 200 cap.
 *
 * One page covers any realistic file, but not every file: a shop re-uploading
 * its whole catalogue can have hundreds of barcodes that already exist, and
 * `commitReadiness` would then say `conflicts_not_loaded` for ever — a Commit
 * button disabled by an answer the client simply had not finished fetching. So
 * the pages are walked and accumulated.
 *
 * **`job.updatedAt` is the accumulator's identity, and that is load-bearing.**
 * Every row write re-reconciles the *whole file*, so a page fetched before a
 * write may describe rows that have since moved — and a resolution that was
 * silently discarded (any `PATCH` on a conflicted row clears it) would
 * otherwise sit in this list claiming the commit is ready, which is exactly the
 * false "yes" `commitReadiness` exists to refuse. `updatedAt` moves on every
 * one of those writes, so when it changes the accumulation starts again.
 */
function useAllConflictRows(jobId: ObjectId, stamp: string): AllConflictRows {
  const [page, setPage] = useState(1);
  const [held, setHeld] = useState<{ stamp: string; rows: ImportRow[] }>({
    stamp,
    rows: [],
  });

  const query = useImportJobConflicts(jobId, page);
  const stale = held.stamp !== stamp;

  useEffect(() => {
    if (stale) {
      setPage(1);
      setHeld({ stamp, rows: [] });
      return;
    }

    const data = query.data;
    // `keepPreviousData` on `useImportJob` means `data` can still be the
    // previous page while the next one is in flight; merging it again is
    // harmless, but advancing off it would skip a page.
    if (!data || data.rowsMeta.page !== page) return;

    setHeld((current) => {
      if (current.stamp !== stamp) return current;
      const byIndex = new Map(current.rows.map((row) => [row.index, row]));
      for (const row of data.rows) byIndex.set(row.index, row);
      return {
        stamp,
        rows: [...byIndex.values()].sort((a, b) => a.index - b.index),
      };
    });

    if (data.rowsMeta.page < data.rowsMeta.totalPages) setPage(page + 1);
  }, [stale, stamp, query.data, page]);

  const totalPages = query.data?.rowsMeta.totalPages ?? 1;

  return {
    rows: stale ? [] : held.rows,
    isLoading: stale || query.isPending || page < totalPages,
    error: query.error,
  };
}

/* ------------------------------------------------------------------------ */
/* Chrome                                                                    */
/* ------------------------------------------------------------------------ */

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-5 rounded-[10px] border border-border bg-card p-[18px]">
      {children}
    </section>
  );
}

function Heading() {
  return (
    <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
      Step 4 · Commit
    </h2>
  );
}

/** The canvas sets every figure in the mono face; the words around it are not. */
function Figure({ children }: { children: React.ReactNode }) {
  return <span className="font-mono">{children}</span>;
}
