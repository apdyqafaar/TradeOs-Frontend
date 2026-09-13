"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import { DigestStatusBadge } from "@/features/insights/components/digest-status";
import { useDigests } from "@/features/insights/hooks/use-digests";
import type { DigestSummary } from "@/features/insights/types";
import { formatDateTime, formatLocalDate } from "@/lib/format/date";

const PAGE_SIZE = 10;
const SKELETON_ROWS = 3;

/** The first headline a member would actually read, whichever section wrote one. */
function headlineOf(summary: DigestSummary): string {
  return (
    summary.sections.sales?.headline ??
    summary.sections.debts?.headline ??
    summary.sections.stock?.headline ??
    summary.sections.team?.headline ??
    "This run did not finish writing anything."
  );
}

/**
 * Every digest that has ever run, newest first — the record `/insights`
 * itself only shows the latest one of.
 *
 * No `timezone` prop: each row's exact-instant tooltip is rendered in
 * `item.timezone`, the zone THAT digest was written in
 * (`Backend/src/db/models/digest.model.ts:32`), not the organization's current
 * one. Correcting a wrong timezone in Settings used to move every historical
 * row's tooltip, so a digest stamped 21:00 on the 12th showed as "13 Sep 2026
 * 00:00" beside a `localDate` column reading "12 Sep 2026" — the same row
 * contradicting itself. Dropping the parameter makes reaching for the wrong
 * zone a compile error, as `insights-section.tsx` already does for dates.
 */
export function DigestHistory() {
  const [page, setPage] = useState(1);
  const { data, error, isPending, refetch } = useDigests(page, PAGE_SIZE);

  const items = data?.items ?? [];
  const meta = data?.meta;

  return (
    <SectionStrip
      title="History"
      info="Every digest that has run, newest first."
    >
      {error ? (
        <div className="p-[18px]">
          <ErrorCard
            error={error}
            title="Couldn't load earlier digests"
            // A 403 is not a failure to retry — nothing broke, this member
            // simply may not read these any more — so no button that would
            // ask again and be refused identically every time. The reachable
            // path is an Owner removing `reports:view` mid-session: the
            // cached `latest` above stays on screen, and pressing **Older**
            // is a new query key and the first thing to be refused. Same
            // rule as `previous-jobs.tsx` and `ErrorCard`'s own docblock.
            retry={
              error.status === 403
                ? undefined
                : () => {
                    void refetch();
                  }
            }
          />
        </div>
      ) : null}

      {/*
        A failure with nothing cached renders the card and nothing else: an
        empty list under it would read as "no earlier digests" rather than
        "we could not ask". A failure *over* existing rows keeps them — a
        background refetch that 500s should not blank a list the reader was
        already looking at (same convention as `customers-page.tsx` /
        `products-page.tsx`).
      */}
      {error && !data ? null : isPending ? (
        <div className="flex flex-col gap-2 p-[18px]">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder rows with no identity of their own, never reordered
            <Skeleton key={index} className="h-[46px] w-full rounded-[8px]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No earlier digests"
          description={
            page > 1
              ? "Nothing on this page any more."
              : "Digests you generate, or that run overnight, collect here."
          }
        />
      ) : (
        <ul className="flex flex-col px-[18px] pt-1.5 pb-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 border-border/60 border-b py-2.5 last:border-b-0"
            >
              <Link
                href={ROUTES.insight(item.id)}
                title={formatDateTime(item.createdAt, item.timezone)}
                className="w-[110px] flex-none rounded-sm font-mono text-[12px] text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {formatLocalDate(item.localDate)}
              </Link>
              <DigestStatusBadge status={item.status} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                {headlineOf(item)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 ? (
        <nav
          aria-label="Digest pages"
          className="flex items-center justify-between gap-3 border-border border-t px-[18px] py-3"
        >
          <span className="font-mono text-[11px] text-muted-2">
            Page {meta.page} of {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Newer
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Older
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : null}
    </SectionStrip>
  );
}
