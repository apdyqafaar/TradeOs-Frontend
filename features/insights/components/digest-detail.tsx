"use client";

import { ButtonLink } from "@/components/shared/button-link";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { DigestView } from "@/features/insights/components/digest-view";
import { TraceSection } from "@/features/insights/components/trace-section";
import { useDigest } from "@/features/insights/hooks/use-digests";
import { formatDigestPeriod } from "@/features/insights/lib/period";
import { useCurrencyConfig } from "@/features/organization/hooks/use-currency-config";
import { formatDateTime, formatLocalDate } from "@/lib/format/date";

/**
 * One digest, by id — `/insights/:id`, reached from the history list.
 *
 * `useDigest` is not `useLatestDigest`: a 404 here means the specific digest
 * this link pointed at is gone (deleted, or the id is simply wrong), not "no
 * digest has ever run" — the two need different words.
 */
export function DigestDetail({ id }: { id: string }) {
  const digest = useDigest(id);
  // The currency the shop keeps its books in, for the `unit: "money"` figures.
  // No amount on a digest carries one — no report payload in this API does —
  // and `""` until it answers renders a bare number rather than a wrong code.
  const currency = useCurrencyConfig();

  const back = (
    <ButtonLink variant="ghost" href={ROUTES.insights}>
      Back to Insights
    </ButtonLink>
  );

  if (digest.error) {
    // Nothing broke — the caller simply may not read this any more. A
    // generic `<ErrorCard retry>` would offer a "Try again" that fails
    // identically forever. Compare `reports-hub.tsx`.
    if (digest.error.status === 403) return <ForbiddenScreen />;
    // 422 as well as 404, because a malformed id never reaches the handler:
    // `GET /digests/:id` runs `validate({ params: idParamSchema })` first
    // (`Backend/src/routes/v1/digest.route.ts:48`), and a non-ObjectId is a
    // `ValidationError` — 422 (`Backend/src/util/errors.ts:116`). A shared or
    // truncated link (`/insights/abc`) is the likeliest way to arrive at a
    // wrong id, and it used to land on a destructive card offering "Try
    // again" on a refusal that will never change its mind. Both mean the same
    // thing to the reader: the digest this link points at is not there.
    if (digest.error.status === 404 || digest.error.status === 422) {
      return (
        <div className="flex flex-col gap-6">
          {back}
          <EmptyState
            title="This digest was removed"
            description="It may have been deleted, or the link is wrong."
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        {back}
        <ErrorCard
          error={digest.error}
          retry={() => {
            void digest.refetch();
          }}
        />
      </div>
    );
  }

  // Pending, or the paused state React Query's default `networkMode: "online"`
  // produces when the browser reports offline (`isPending: true, data:
  // undefined, error: null`). `isPending` rather than `isLoading` so the three
  // components on this feature agree on one predicate — and a skeleton rather
  // than the `return null` that used to sit here, which rendered a completely
  // blank content area with not even the way back on it.
  if (digest.isPending || !digest.data) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <Skeleton className="h-[420px] rounded-[12px]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {back}
      {/*
        The detail page owns its own header, because `DigestView` deliberately
        has none: `/insights` prints the day and the window in the page header
        above it, and a second copy inside the panel would be the same fact
        twice on one screen.

        `formatLocalDate`, never `formatDate`: `localDate` is a bare
        `yyyy-MM-dd` the server already resolved in the shop's zone, and
        `formatDate` would re-parse it as UTC midnight and print the day BEFORE
        for any shop west of Greenwich. That has shipped three times here.

        The window comes from `period` when the row carries one, rendered in
        `digest.data.timezone` — the zone THIS digest was written in, not the
        organization's current one, so correcting a wrong timezone in Settings
        cannot make an old row's rendered day disagree with its own `localDate`.
      */}
      <header className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[32px] text-foreground leading-[1.1]">
          {formatLocalDate(digest.data.localDate)}
        </h1>
        <p className="text-[13px] text-muted-foreground">
          {[
            formatDigestPeriod(digest.data.period, digest.data.timezone),
            `written ${formatDateTime(digest.data.generatedAt, digest.data.timezone)}`,
            digest.data.timezone,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>
      <DigestView digest={digest.data} currency={currency.mainCurrency} />
      <TraceSection digest={digest.data} />
    </div>
  );
}
