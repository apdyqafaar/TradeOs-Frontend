"use client";

import { cn } from "cn";
import { Fragment, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ObjectId } from "@/lib/api/types";
import { formatMoney, formatQuantity } from "@/lib/format/money";
import { spreadsheetRowNumber } from "../schemas/import.schema";
import type { ImportColumnMap, ImportRow, ImportRowStatus } from "../types";
import { ConflictBanner } from "./conflict-banner";
import { rowMessages } from "./row-message";

/**
 * The seven columns artboard `2e` draws, plus the actions the design implies
 * but does not draw — a reviewer has to be able to fix and skip a row from the
 * list, and the canvas only shows the conflict banner's buttons.
 *
 * Named rather than counted so the skeleton's cells have real keys and the
 * full-width rows have a `colSpan` that cannot drift from the header.
 */
const COLUMN_KEYS = [
  "row",
  "name",
  "category",
  "cost",
  "price",
  "qty",
  "message",
  "actions",
] as const;

const COLUMN_COUNT = COLUMN_KEYS.length;

/** Fixed identities for the placeholder rows; an index key is a bug elsewhere. */
const SKELETON_KEYS = [
  "skeleton-1",
  "skeleton-2",
  "skeleton-3",
  "skeleton-4",
  "skeleton-5",
  "skeleton-6",
] as const;

/**
 * The badge each status wears when a row has nothing else to say.
 *
 * `ready` gets no badge at all — a table where every good row shouts "Ready" is
 * a table nobody can scan for the bad ones.
 */
const STATUS_BADGE: Record<
  ImportRowStatus,
  { label: string; tone: string } | null
> = {
  ready: null,
  needs_attention: {
    label: "Needs attention",
    tone: "bg-warning-soft text-warning-strong",
  },
  conflict: {
    label: "Conflict",
    tone: "bg-destructive-soft text-destructive-strong",
  },
  skipped: { label: "Skipped", tone: "bg-muted text-muted-foreground" },
};

export interface ImportRowsTableProps {
  jobId: ObjectId;
  rows: ImportRow[];
  /** Field → header. Lets a message name the reviewer's own cell. */
  columnMap: ImportColumnMap;
  /** The organization's main currency — an import job carries none. */
  currency: string;
  isLoading: boolean;
  /** A refetch is in flight over rows already on screen. Dim, do not unmount. */
  isStale: boolean;
  emptyState: ReactNode;
  onFix: (row: ImportRow) => void;
  onSkip: (row: ImportRow) => void;
  /** There is no un-skip endpoint; this is a `PATCH` — see `ReviewStep`. */
  onRestore: (row: ImportRow) => void;
  /** The row a skip/restore is currently in flight for, if any. */
  pendingIndex?: number;
  /** Whether the job is still `reviewing`. A committed job is read-only. */
  editable: boolean;
  onStale?: () => void;
}

/**
 * Artboard `2e`'s review table (`docs/design/TradeOs-UI.dc.html:766-806`): Row,
 * Name, Category, Cost, Price, Qty, Message — with the conflict banner drawn
 * full-width beneath the row it belongs to, as the canvas has it.
 *
 * Written as a real `<table>` rather than reusing `components/shared/data-table`
 * for one reason: the conflict banner and the message details are **rows that
 * span every column**, and a column-per-cell renderer cannot express that. A
 * grid of `<div>`s could, but then a screen reader loses the row/column
 * relationships on the one screen whose whole job is "which line of my
 * spreadsheet is wrong".
 *
 * ### The Message column is translated, never echoed
 *
 * `row.errors` holds raw zod text unfit for a shopkeeper — see `row-message.ts`
 * and `docs/findings/slice4-import-live-observations.md` §1. This renders
 * `rowMessages()`; the API's own words go in the `title` and in the expanded
 * details, where a support conversation can still find them.
 *
 * **A note is not a problem.** A `ready` row can carry one
 * (`"Category \"Grains\" does not exist yet — it will be created on commit"`),
 * so notes are drawn in the quiet muted style and never in the warning tint.
 */
export function ImportRowsTable({
  jobId,
  rows,
  columnMap,
  currency,
  isLoading,
  isStale,
  emptyState,
  onFix,
  onSkip,
  onRestore,
  pendingIndex,
  editable,
  onStale,
}: ImportRowsTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const toggle = (index: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  const money = (value?: number) =>
    value === undefined ? "—" : formatMoney(value, currency).trim();

  const isEmpty = !isLoading && rows.length === 0;

  return (
    <div className="overflow-x-auto rounded-[10px] border border-border bg-card">
      <table className="w-full border-collapse text-left text-[13px]">
        <caption className="sr-only">
          Rows staged for import. Row numbers match your spreadsheet, where line
          1 is the header.
        </caption>
        <thead className="bg-muted/60">
          <tr>
            <Th className="w-[68px]">Row</Th>
            <Th>Name</Th>
            <Th className="hidden md:table-cell">Category</Th>
            <Th align="end">Cost</Th>
            <Th align="end">Price</Th>
            <Th align="end">Qty</Th>
            <Th>Message</Th>
            <Th className="w-[132px]">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>

        <tbody className={cn(isStale && "opacity-60 transition-opacity")}>
          {isLoading
            ? SKELETON_KEYS.map((key) => (
                <tr key={key} className="border-border border-b last:border-0">
                  {COLUMN_KEYS.map((column) => (
                    <td key={`${key}-${column}`} className="px-3 py-3">
                      <Skeleton className="h-4 w-full max-w-[10ch]" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => {
                const messages = rowMessages(row, columnMap);
                const [first, ...rest] = messages;
                const badge = STATUS_BADGE[row.status];
                const open = expanded.has(row.index);
                const busy = pendingIndex === row.index;

                return (
                  <Fragment key={row.index}>
                    <tr
                      className={cn(
                        "border-border border-b last:border-0",
                        row.status === "skipped" && "text-muted-foreground",
                      )}
                    >
                      <td className="px-3 py-2.5 font-mono text-[12px] text-muted-foreground">
                        {/* 0-based over data rows, so the spreadsheet line is
                            index + 2 (contract Trap 6). */}
                        {spreadsheetRowNumber(row.index)}
                      </td>
                      <td className="px-3 py-2.5 text-foreground">
                        <span
                          className={cn(
                            "line-clamp-2",
                            row.status === "skipped" && "line-through",
                          )}
                        >
                          {row.parsed.name ?? (
                            <span className="text-muted-foreground italic">
                              No name
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="hidden px-3 py-2.5 text-muted-foreground md:table-cell">
                        {row.parsed.category ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-foreground">
                        {money(row.parsed.costPrice)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-foreground">
                        {money(row.parsed.sellingPrice)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-foreground">
                        {/* `formatQuantity`, not `formatMoney`: goods are sold
                            by weight and a quantity carries up to 3 dp. */}
                        {row.parsed.trackStock === false
                          ? "—"
                          : formatQuantity(row.parsed.quantity ?? 0)}
                      </td>

                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {first ? (
                            <span
                              // The API's own words, reachable but never primary.
                              title={first.raw}
                              // A note must never be dressed as a fault, and
                              // that is the sort of thing a class-string diff
                              // breaks silently — so the distinction is a
                              // first-class attribute a test can hold on to.
                              data-tone={first.tone}
                              className={cn(
                                "inline-flex max-w-full items-center rounded-lg px-2 py-0.5 font-medium text-[11px]",
                                first.tone === "problem"
                                  ? row.status === "conflict"
                                    ? "bg-destructive-soft text-destructive-strong"
                                    : "bg-warning-soft text-warning-strong"
                                  : // A note is information, not a fault.
                                    "bg-muted text-muted-foreground",
                              )}
                            >
                              <span className="truncate">{first.text}</span>
                            </span>
                          ) : badge ? (
                            <span
                              className={cn(
                                "inline-flex items-center rounded-lg px-2 py-0.5 font-medium text-[11px]",
                                badge.tone,
                              )}
                            >
                              {badge.label}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}

                          {rest.length > 0 || first?.raw ? (
                            <button
                              type="button"
                              onClick={() => toggle(row.index)}
                              aria-expanded={open}
                              className="rounded-md px-1 font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                              {open
                                ? "hide"
                                : rest.length > 0
                                  ? `+${rest.length} more`
                                  : "details"}
                            </button>
                          ) : null}
                        </div>
                      </td>

                      <td className="px-3 py-2.5">
                        {editable ? (
                          <div className="flex items-center justify-end gap-1">
                            {row.status === "skipped" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => onRestore(row)}
                                className="h-7 px-2 text-[12px]"
                              >
                                Restore
                              </Button>
                            ) : (
                              <>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => onFix(row)}
                                  className="h-7 px-2 text-[12px]"
                                >
                                  Fix
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => onSkip(row)}
                                  className="h-7 px-2 text-[12px] text-muted-foreground"
                                >
                                  Skip
                                </Button>
                              </>
                            )}
                          </div>
                        ) : null}
                      </td>
                    </tr>

                    {open ? (
                      <tr className="border-border border-b bg-muted/40 last:border-0">
                        <td colSpan={COLUMN_COUNT} className="px-4 py-3">
                          <ul className="flex flex-col gap-1.5">
                            {messages.map((message) => (
                              <li
                                key={message.key}
                                className="flex flex-col gap-0.5"
                              >
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
                              // The server's duplicate message quotes 0-based
                              // data indexes (contract Trap 6). It cannot be
                              // rewritten without string-matching it, so the
                              // screen says which numbering it uses instead.
                              <li className="text-[11px] text-muted-foreground">
                                The row numbers above count from the first data
                                row, so add 2 for the spreadsheet line.
                              </li>
                            ) : null}
                          </ul>
                        </td>
                      </tr>
                    ) : null}

                    {row.status === "conflict" ? (
                      <tr className="border-border border-b last:border-0">
                        <td colSpan={COLUMN_COUNT} className="p-0">
                          <ConflictBanner
                            jobId={jobId}
                            row={row}
                            currency={currency}
                            onStale={onStale}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
        </tbody>
      </table>

      {isEmpty ? emptyState : null}
    </div>
  );
}

function Th({
  children,
  align,
  className,
}: {
  children: ReactNode;
  align?: "end";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "border-border border-b px-3 py-2.5 font-mono font-medium text-[10px] text-muted-foreground uppercase tracking-[0.08em]",
        align === "end" && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}
