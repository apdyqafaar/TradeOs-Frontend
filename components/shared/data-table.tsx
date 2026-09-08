"use client";

import { cn } from "cn";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PageMeta } from "@/lib/api/types";

export interface DataTableColumn<T> {
  /** Stable identity for the column, and the field name sent as `sort` when sortable. */
  key: string;
  header: string;
  sortable?: boolean;
  cell: (row: T) => ReactNode;
  /** Money and quantities are right-aligned so digits line up — brief §8.1. */
  align?: "start" | "end";
  /** Applied to both the header cell and every body cell in the column. */
  className?: string;
  /** Hidden below `md`. Use for columns a phone can do without rather than shrinking everything. */
  hideBelowMd?: boolean;
}

export type SortDirection = "asc" | "desc";

export interface DataTableSort {
  key: string;
  direction: SortDirection;
}

export interface DataTablePagination extends PageMeta {
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** First paint, no data yet: render skeleton rows instead of an empty table. */
  isLoading?: boolean;
  /**
   * Data is on screen but a refetch is in flight (page change, filter change).
   * Dims the body rather than unmounting it, so the table does not collapse to
   * a spinner and shove the page around on every keystroke.
   */
  isStale?: boolean;
  /** Rendered in place of the table body when there are no rows and nothing is loading. */
  emptyState?: ReactNode;
  onRowClick?: (row: T) => void;
  /**
   * Sorting is controlled and server-side — the API sorts, not the browser,
   * because only page 1 of N is ever in memory. Sorting locally would silently
   * reorder one page and lie about the rest.
   */
  sort?: DataTableSort;
  onSortChange?: (sort: DataTableSort) => void;
  pagination?: DataTablePagination;
  /** Announced to screen readers; every table needs one. */
  caption: string;
  className?: string;
}

const LIMIT_OPTIONS = [25, 50, 100] as const;

/**
 * Fixed identities for the loading placeholder rows. An array index would do
 * the job here — these rows never reorder — but naming them keeps the lint rule
 * meaningful everywhere else, where an index key really is a bug.
 */
const SKELETON_ROW_KEYS = [
  "skeleton-1",
  "skeleton-2",
  "skeleton-3",
  "skeleton-4",
  "skeleton-5",
  "skeleton-6",
  "skeleton-7",
  "skeleton-8",
] as const;

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  isLoading = false,
  isStale = false,
  emptyState,
  onRowClick,
  sort,
  onSortChange,
  pagination,
  caption,
  className,
}: DataTableProps<T>) {
  const isEmpty = !isLoading && rows.length === 0;

  const handleSort = (column: DataTableColumn<T>) => {
    if (!column.sortable || !onSortChange) return;
    const nextDirection: SortDirection =
      sort?.key === column.key && sort.direction === "asc" ? "desc" : "asc";
    onSortChange({ key: column.key, direction: nextDirection });
  };

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Wide tables scroll inside their own container; the page body never scrolls sideways. */}
      <div className="relative overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-left text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
            <tr>
              {columns.map((column) => {
                const isSorted = sort?.key === column.key;
                const SortIcon = !isSorted
                  ? ChevronsUpDown
                  : sort.direction === "asc"
                    ? ChevronUp
                    : ChevronDown;

                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      isSorted
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={cn(
                      "border-b border-border px-3 py-2.5 font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase",
                      column.align === "end" && "text-right",
                      column.hideBelowMd && "hidden md:table-cell",
                      column.className,
                    )}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          column.align === "end" && "flex-row-reverse",
                          isSorted && "text-foreground",
                        )}
                      >
                        {column.header}
                        <SortIcon className="size-3" aria-hidden="true" />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className={cn(isStale && "opacity-60 transition-opacity")}>
            {isLoading
              ? SKELETON_ROW_KEYS.map((rowKey) => (
                  <tr
                    key={rowKey}
                    className="border-b border-border last:border-0"
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          "px-3 py-3",
                          column.hideBelowMd && "hidden md:table-cell",
                        )}
                      >
                        <Skeleton className="h-4 w-full max-w-[12ch]" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={getRowId(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "border-b border-border last:border-0",
                      onRowClick && "cursor-pointer hover:bg-muted/50",
                    )}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          "px-3 py-3 align-middle",
                          column.align === "end" && "text-right",
                          column.hideBelowMd && "hidden md:table-cell",
                          column.className,
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>

        {isEmpty ? emptyState : null}
      </div>

      {pagination && !isEmpty ? <Pagination {...pagination} /> : null}
    </div>
  );
}

function Pagination({
  page,
  limit,
  total,
  totalPages,
  onPageChange,
  onLimitChange,
}: DataTablePagination) {
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-3">
      <p className="font-mono text-xs text-muted-foreground">
        {first}–{last} of {total}
      </p>

      <div className="flex items-center gap-3">
        {onLimitChange ? (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Rows</span>
            <select
              value={limit}
              onChange={(event) => onLimitChange(Number(event.target.value))}
              className="h-7 rounded-md border border-border bg-background px-1.5 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="px-2 font-mono text-xs text-muted-foreground">
            {page} / {Math.max(totalPages, 1)}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
