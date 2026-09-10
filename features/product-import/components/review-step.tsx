"use client";

import { cn } from "cn";
import { FileSpreadsheet } from "lucide-react";
import { parseAsInteger, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useId, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { useImportJob } from "../hooks/use-import-job";
import {
  usePatchImportRow,
  useSkipImportRow,
} from "../hooks/use-import-mutations";
import {
  IMPORT_ROW_STATUS_FILTERS,
  type ImportJobSummary,
  type ImportRow,
  type ImportRowStatusFilter,
  MAX_IMPORT_ROW_LIMIT,
} from "../types";
import { FixRowDialog } from "./fix-row-dialog";
import { ImportRowsTable } from "./import-rows-table";

/**
 * The five tabs, labelled. Typed against `ImportRowStatusFilter` so the strip
 * cannot offer a sixth value: `?status=` is validated by a `.strict()` schema,
 * so anything outside this list is a 422 rather than an ignored key.
 *
 * **`needsAttention` here is the camelCase `counts` key; the row status is the
 * snake_case `needs_attention`.** Both spellings are real and they are not
 * interchangeable — `counts[row.status]` is `undefined` (types.ts rule 4). The
 * two are joined explicitly below rather than by indexing one with the other.
 */
const TAB_LABELS: Record<ImportRowStatusFilter, string> = {
  all: "All rows",
  needs_attention: "Needs attention",
  conflict: "Conflicts",
  ready: "Ready",
  skipped: "Skipped",
};

/** The count chip's tint per tab — artboard `2e`'s per-tab `bg`/`fg`. */
const TAB_TONES: Record<ImportRowStatusFilter, string> = {
  all: "bg-muted text-muted-foreground",
  needs_attention: "bg-warning-soft text-warning-strong",
  conflict: "bg-destructive-soft text-destructive-strong",
  ready: "bg-success-soft text-success-soft-foreground",
  skipped: "bg-muted text-muted-foreground",
};

/**
 * Page sizes. **200 is real here and is not a typo**: every other list endpoint
 * in this API caps `limit` at 100, this one at 200
 * (`product-import.validation.ts:15`), and `?limit=201` is a 422. A 2,000-row
 * review is ten calls at the cap and twenty at the shared constant.
 */
const LIMIT_OPTIONS = [25, 50, 100, MAX_IMPORT_ROW_LIMIT] as const;

/**
 * The filter state, in the URL — `CLAUDE.md`: a filtered list must survive a
 * reload, a shared link and the back button.
 *
 * The keys are prefixed `row` because the wizard shell around this owns the
 * query string too, and a bare `page` would collide with the jobs list beside
 * it. `status` defaults to `"all"`, which is also the server's own default, so
 * nuqs drops the key and the bare URL asks for exactly what the server would
 * have given anyway.
 */
const ROW_FILTER_PARSERS = {
  rowStatus: parseAsStringLiteral(IMPORT_ROW_STATUS_FILTERS).withDefault("all"),
  rowPage: parseAsInteger.withDefault(1),
  rowLimit: parseAsInteger.withDefault(50),
};

export interface ReviewStepProps {
  jobId: ObjectId;
  /** The job as the wizard fetched it — `counts`, `columnMap` and `status`. */
  job: ImportJobSummary;
}

/**
 * Step 3 of artboard `2e` — review the staged rows and fix or skip the ones
 * that cannot be imported (`docs/design/TradeOs-UI.dc.html:762-806`).
 *
 * Self-contained by design: it owns its row query, its filter state, its
 * mutations and its dialogs, so the wizard shell around it only has to hand
 * over a job id and the job.
 *
 * ### Why every write invalidates the whole job
 *
 * **A row write can change rows nobody touched.** Every mutating service
 * function re-runs `reconcileRows` over the *whole file* and recomputes
 * `counts` (`product-import.service.ts:189-192`), so fixing one half of a
 * duplicate-barcode pair flips the other half to `ready` on a page nobody has
 * open (`import.test.ts:281-291`). None of the three row endpoints returns the
 * new `counts`, and none of them returns the other rows — so there is nothing
 * to patch in place with, and `use-import-mutations.ts` invalidates
 * `importKeys.detail(jobId)`, which is a prefix of every page and every status
 * filter of this job. This component therefore never merges a mutation
 * response into its own list; it lets the refetch tell it the truth.
 *
 * ### Six states, per brief §8.4
 *
 * Loading skeleton, empty, filtered-empty (with a way back to all rows), a
 * failure carrying its request id, a 403 that does not offer a pointless retry,
 * and each row endpoint's 409/422 shown at the control that provoked it — the
 * fix dialog, the skip button, the conflict banner.
 */
export function ReviewStep({ jobId, job }: ReviewStepProps) {
  const panelId = useId();
  const [filters, setFilters] = useQueryStates(ROW_FILTER_PARSERS, {
    history: "replace",
    scroll: false,
  });

  const { currency, isLoading: currencyLoading } = useOrganization();

  const page = useImportJob(jobId, {
    status: filters.rowStatus,
    page: filters.rowPage,
    limit: filters.rowLimit,
  });

  const skip = useSkipImportRow();
  const patch = usePatchImportRow();
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const rows = page.data?.rows ?? [];
  const meta = page.data?.rowsMeta;
  const editable = job.status === "reviewing";

  // `counts` is keyed camelCase while a row's `status` is snake_case, so the
  // join is written out rather than done by indexing. `all` is `totalRows`,
  // which is the only tally that is not in `counts` at all.
  const countFor = (filter: ImportRowStatusFilter): number => {
    switch (filter) {
      case "all":
        return job.totalRows;
      case "needs_attention":
        return job.counts.needsAttention;
      case "conflict":
        return job.counts.conflict;
      case "ready":
        return job.counts.ready;
      case "skipped":
        return job.counts.skipped;
    }
  };

  const selectTab = (status: ImportRowStatusFilter) => {
    setRowError(null);
    // Page 1, always: page 4 of "all rows" is very likely past the end of
    // "conflicts", and landing on an empty page reads as "there are none".
    void setFilters({ rowStatus: status, rowPage: 1 });
  };

  const rowFailed = (error: ApiError) => {
    // Branch on `code`, never on `message` (CLAUDE.md).
    if (error.code === API_ERROR_CODE.IMPORT_ROW_NOT_FOUND) {
      setRowError(
        "That row is no longer part of this import. The list has been refreshed.",
      );
      return;
    }
    if (error.code === API_ERROR_CODE.IMPORT_NOT_REVIEWING) {
      setRowError(
        "This import has already been committed or cancelled, so its rows can no longer be changed.",
      );
      return;
    }
    setRowError(error.message);
  };

  const onSkip = (row: ImportRow) => {
    setRowError(null);
    // 200 with the row, not a 204 — the row stays in the file as `skipped`
    // and counts towards `result.skipped` at commit (contract §7).
    skip.mutate({ jobId, index: row.index }, { onError: rowFailed });
  };

  const onRestore = (row: ImportRow) => {
    setRowError(null);
    // **There is no un-skip endpoint.** A `PATCH` re-validates and reassigns
    // `ready`/`needs_attention` unconditionally, which is what revives the row
    // (contract Trap 9). One real field off the row's own `parsed` is enough
    // now that `Backend` 48c7205 stopped the zod defaults leaking — echoing
    // `unit`, `trackStock` and `quantity` "defensively" today would write three
    // fields nobody touched. `unit` is always present: `cleanRow` sets it to
    // `"pcs"` when the file has no unit column.
    patch.mutate(
      {
        jobId,
        index: row.index,
        input: { unit: row.parsed.unit ?? "pcs" },
      },
      { onError: rowFailed },
    );
  };

  const pendingIndex = skip.isPending
    ? skip.variables?.index
    : patch.isPending
      ? patch.variables?.index
      : undefined;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
          Step 3 · Review rows
        </h2>
        <p className="font-mono text-[11px] text-muted-foreground">
          Row numbers match your spreadsheet — line 1 is the header.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Row status"
        className="flex flex-wrap gap-2"
      >
        {IMPORT_ROW_STATUS_FILTERS.map((filter) => {
          const active = filter === filters.rowStatus;
          return (
            <button
              key={filter}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              onClick={() => selectTab(filter)}
              className={cn(
                "inline-flex h-[34px] items-center gap-2 rounded-[9px] border px-[13px] text-[13px] transition-colors",
                active
                  ? "border-primary bg-primary-soft text-primary-soft-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {TAB_LABELS[filter]}
              <span
                className={cn(
                  "inline-flex h-5 items-center rounded-md px-[7px] font-mono font-medium text-[11px]",
                  TAB_TONES[filter],
                )}
              >
                {countFor(filter)}
              </span>
            </button>
          );
        })}
      </div>

      {rowError ? (
        <p
          role="alert"
          className="rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong"
        >
          {rowError}
        </p>
      ) : null}

      <div id={panelId} className="flex flex-col gap-3">
        {page.error ? (
          <ErrorCard
            error={page.error}
            title={
              page.error.status === 403
                ? "You cannot review this import"
                : "Couldn't load these rows"
            }
            // A 403 will answer identically however many times it is asked, so
            // no retry is offered — brief §8.4.
            retry={
              page.error.status === 403 ? undefined : () => void page.refetch()
            }
          />
        ) : (
          <ImportRowsTable
            jobId={jobId}
            rows={rows}
            columnMap={job.columnMap}
            currency={currency}
            isLoading={page.isPending || currencyLoading}
            isStale={page.isFetching && !page.isPending}
            editable={editable}
            pendingIndex={pendingIndex}
            onFix={(row) => {
              setRowError(null);
              setEditing(row);
            }}
            onSkip={onSkip}
            onRestore={onRestore}
            onStale={() => void page.refetch()}
            emptyState={
              filters.rowStatus === "all" ? (
                <EmptyState
                  icon={FileSpreadsheet}
                  title="No rows in this file"
                  description="Nothing was read out of the uploaded file. Check the column mapping in step 2."
                />
              ) : (
                <EmptyState
                  icon={FileSpreadsheet}
                  title={`Nothing is ${TAB_LABELS[filters.rowStatus].toLowerCase()}`}
                  description="That is good news — this filter is empty."
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selectTab("all")}
                    >
                      Show all rows
                    </Button>
                  }
                />
              )
            }
          />
        )}

        {meta && meta.total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <p className="font-mono text-xs text-muted-foreground">
              {(meta.page - 1) * meta.limit + 1}–
              {Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
            </p>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <span>Rows</span>
                <select
                  value={filters.rowLimit}
                  onChange={(event) =>
                    void setFilters({
                      rowLimit: Number(event.target.value),
                      rowPage: 1,
                    })
                  }
                  className="h-7 rounded-md border border-border bg-background px-1.5 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {LIMIT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page <= 1}
                  onClick={() => void setFilters({ rowPage: meta.page - 1 })}
                >
                  Previous
                </Button>
                <span className="px-2 font-mono text-muted-foreground text-xs">
                  {meta.page} / {Math.max(meta.totalPages, 1)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => void setFilters({ rowPage: meta.page + 1 })}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {editing ? (
        <FixRowDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          jobId={jobId}
          // Re-read from the freshly fetched page rather than from the row the
          // button was pressed on: a file-wide reconciliation may have moved it
          // between the click and the render, and editing a stale `parsed`
          // would send a diff against values the server no longer holds.
          row={rows.find((row) => row.index === editing.index) ?? editing}
          columnMap={job.columnMap}
          onStale={() => void page.refetch()}
        />
      ) : null}
    </section>
  );
}
