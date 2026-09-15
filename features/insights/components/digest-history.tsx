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
import { headlineOf } from "@/features/insights/lib/digest-shape";
import { DIGEST_PERIOD_LABELS } from "@/features/insights/lib/period";
import type { DigestSummary } from "@/features/insights/types";
import { formatDateTime, formatLocalDate } from "@/lib/format/date";

const PAGE_SIZE = 10;
const SKELETON_ROWS = 3;

/**
 * Every digest that has ever run, newest first — the record `/insights` itself
 * only shows the latest one of.
 *
 * **The whole row is one link**, as the build note asks, rather than a link on
 * the date with four unclickable columns beside it. It is a real `<a>`: this
 * codebase shipped 24 links announced and keyed as buttons, caught only in a
 * browser, and a row is exactly the shape that tempts a `div` with an
 * `onClick`.
 *
 * No `timezone` prop: each row's exact-instant tooltip is rendered in
 * `item.timezone`, the zone THAT digest was written in, not the organization's
 * current one. Correcting a wrong timezone in Settings used to move every
 * historical row's tooltip, so a digest stamped 21:00 on the 12th showed as
 * "13 Sep 2026 00:00" beside a `localDate` column reading "12 Sep 2026" — the
 * same row contradicting itself. Dropping the parameter makes reaching for the
 * wrong zone a compile error.
 *
 * `formatLocalDate`, never `formatDate`: `localDate` is a bare `yyyy-MM-dd` the
 * server already resolved in the shop's zone, and routing it through
 * `formatDate` prints the day *before* for any shop west of Greenwich. That
 * mistake has shipped three times in this repo.
 */
export function DigestHistory() {
  const [page, setPage] = useState(1);
  const { data, error, isPending, refetch } = useDigests(page, PAGE_SIZE);

  const items = data?.items ?? [];
  const meta = data?.meta;

  return (
    <SectionStrip
      title="Earlier digests"
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
            // is a new query key and the first thing to be refused.
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
        already looking at.
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
        <ul className="flex flex-col">
          {items.map((item) => (
            <li
              key={item.id}
              className="border-border/60 border-b last:border-b-0"
            >
              <HistoryRow item={item} />
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

function HistoryRow({ item }: { item: DigestSummary }) {
  const headline = headlineOf(item);

  return (
    <Link
      href={ROUTES.insight(item.id)}
      title={formatDateTime(item.createdAt, item.timezone)}
      className="grid min-h-[48px] grid-cols-[auto_1fr_auto] items-center gap-x-3.5 gap-y-1 px-[18px] py-2.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:grid-cols-[110px_90px_1fr_auto_16px]"
    >
      <span className="font-mono text-[12px] text-foreground">
        {formatLocalDate(item.localDate)}
      </span>
      {/* The window the digest is ABOUT, which is no longer the day it was
          written on. Absent for every row written before the field existed —
          `publicDigest` omits the key rather than back-filling "Today", so
          this does too. */}
      <span className="text-[12px] text-muted-foreground max-lg:hidden">
        {item.period ? DIGEST_PERIOD_LABELS[item.period.preset] : ""}
      </span>
      <span className="col-span-full min-w-0 truncate text-[13px] text-foreground lg:col-span-1">
        {headline ?? "This run did not finish writing anything."}
      </span>
      <DigestStatusBadge status={item.status} className="justify-self-start" />
      <ChevronRight
        className="size-4 text-muted-3 max-lg:hidden"
        aria-hidden="true"
      />
    </Link>
  );
}
