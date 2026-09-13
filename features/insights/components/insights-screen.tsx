"use client";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/features/auth/hooks/use-permission";
import { DigestHistory } from "@/features/insights/components/digest-history";
import { DigestView } from "@/features/insights/components/digest-view";
import { RunDigestButton } from "@/features/insights/components/run-digest-button";
import { TraceView } from "@/features/insights/components/trace-view";
import { useLatestDigest } from "@/features/insights/hooks/use-digests";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { useOrganizationProfile } from "@/features/organization/hooks/use-organization-profile";
import { PERMISSIONS } from "@/lib/auth/permissions";

/** What time the digest arrives when no `ai` settings have loaded yet. */
const DEFAULT_HOUR = 21;

/**
 * `/insights` — the evening digest, written from the day's figures.
 *
 * The permission that runs a digest is `organization:update`
 * (`docs/API-ROUTES.md`, `POST /digests/run`), the same one that gates the
 * settings screen the digest is configured from — not a reports permission,
 * because generating one is a write on the organization's AI usage, not a
 * read of its reports.
 *
 * A 404 on `latest` is "no digest yet", an answer rather than a failure
 * (`useLatestDigest`'s own `retry: false`), so it renders the empty state
 * rather than the error card.
 */
export function InsightsScreen() {
  const latest = useLatestDigest();
  const { timezone, isLoading: organizationLoading } = useOrganization();
  const profile = useOrganizationProfile();
  const canRun = useCan(PERMISSIONS.ORGANIZATION_UPDATE);
  const hour = profile.data?.ai.hourLocal ?? DEFAULT_HOUR;

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="font-serif text-3xl text-foreground">Insights</h1>
        <p className="text-[13px] text-muted-foreground">
          Your evening digest, written from the day's figures.
        </p>
      </div>
      {canRun ? (
        <RunDigestButton sinceLocalDate={latest.data?.localDate ?? null} />
      ) : null}
    </div>
  );

  if (latest.isLoading || organizationLoading) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Skeleton className="h-[420px] rounded-[12px]" />
      </div>
    );
  }

  if (latest.error && latest.error.status !== 404) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ErrorCard
          error={latest.error}
          retry={() => {
            void latest.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      {latest.data ? (
        <>
          <DigestView digest={latest.data} timezone={timezone} />
          <section className="flex flex-col gap-3">
            <h2 className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
              What the analysts looked at
            </h2>
            <p className="font-mono text-[11px] text-muted-2">
              {latest.data.usage.calls} analyst turns ·{" "}
              {latest.data.usage.routerCalls} routing decisions ·{" "}
              {latest.data.trace.length} tool calls
            </p>
            <TraceView trace={latest.data.trace} />
          </section>
        </>
      ) : (
        <EmptyState
          title="No digest yet"
          description={`Your first one arrives at ${String(hour).padStart(2, "0")}:00 tonight${
            canRun ? ", or generate one now" : ""
          }.`}
        />
      )}
      <DigestHistory timezone={timezone} />
    </div>
  );
}
