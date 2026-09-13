"use client";

import { ButtonLink } from "@/components/shared/button-link";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { DigestView } from "@/features/insights/components/digest-view";
import { TraceView } from "@/features/insights/components/trace-view";
import { useDigest } from "@/features/insights/hooks/use-digests";
import { useOrganization } from "@/features/organization/hooks/use-organization";

/**
 * One digest, by id — `/insights/:id`, reached from the history list.
 *
 * `useDigest` is not `useLatestDigest`: a 404 here means the specific digest
 * this link pointed at is gone (deleted, or the id is simply wrong), not "no
 * digest has ever run" — the two need different words.
 */
export function DigestDetail({ id }: { id: string }) {
  const digest = useDigest(id);
  const { timezone, isLoading: organizationLoading } = useOrganization();

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
  if (digest.isPending || organizationLoading || !digest.data) {
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
      <DigestView digest={digest.data} timezone={timezone} />
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
          What the analysts looked at
        </h2>
        <p className="font-mono text-[11px] text-muted-2">
          {digest.data.usage.calls} analyst turns ·{" "}
          {digest.data.usage.routerCalls} routing decisions ·{" "}
          {digest.data.trace.length} tool calls
        </p>
        <TraceView trace={digest.data.trace} />
      </section>
    </div>
  );
}
