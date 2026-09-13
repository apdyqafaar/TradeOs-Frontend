"use client";

import { ButtonLink } from "@/components/shared/button-link";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
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

  if (digest.isLoading || organizationLoading) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <Skeleton className="h-[420px] rounded-[12px]" />
      </div>
    );
  }

  if (digest.error) {
    if (digest.error.status === 404) {
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

  if (!digest.data) return null;

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
