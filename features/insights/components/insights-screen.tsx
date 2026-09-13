"use client";

import { ButtonLink } from "@/components/shared/button-link";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { DigestHistory } from "@/features/insights/components/digest-history";
import { DigestView } from "@/features/insights/components/digest-view";
import { RunDigestButton } from "@/features/insights/components/run-digest-button";
import { TraceSection } from "@/features/insights/components/trace-section";
import { useLatestDigest } from "@/features/insights/hooks/use-digests";
import { useOrganizationProfile } from "@/features/organization/hooks/use-organization-profile";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * `/insights` — the evening digest, written from the day's figures.
 *
 * The permission that runs a digest is `organization:update`
 * (`docs/API-ROUTES.md`, `POST /digests/run`), the same one that gates the
 * settings screen the digest is configured from — not a reports permission,
 * because generating one is a write on the organization's AI usage, not a
 * read of its reports. It is also the permission `/settings` itself is gated
 * on, so the one flag decides both the button and the link below.
 *
 * A 404 on `latest` is "no digest yet", an answer rather than a failure
 * (`useLatestDigest`'s own `retry: false`), so it renders the empty state
 * rather than the error card.
 *
 * **"No digest yet" is two different states, and this screen used to conflate
 * them.** `ai.enabled` defaults to `false`
 * (`Backend/src/db/models/organization.model.ts:38`), so every tenant starts
 * with the feature switched off — and this screen read `ai.hourLocal` without
 * ever reading `ai.enabled`, telling those shops their first digest arrived at
 * 21:00 tonight and offering a Generate button whose only possible answer was
 * `409 AI_DISABLED_FOR_ORGANIZATION`. Three states now, and the Overview strip
 * (`features/dashboard/components/insights-section.tsx`) renders the same
 * three from the same `ai.enabled`, so the two screens cannot contradict each
 * other.
 */
export function InsightsScreen() {
  const latest = useLatestDigest();
  const profile = useOrganizationProfile();
  const canRun = useCan(PERMISSIONS.ORGANIZATION_UPDATE);

  // `null` — not `false` — when the profile could not be read: a role holding
  // `reports:view` but not `organization:view` gets a 403 here, and "we do not
  // know" must not be rendered as "it is off".
  const ai = profile.data?.ai ?? null;

  // Nothing broke — the caller simply may not read this any more.
  // `requirePageAccess` already gated the route server-side, but that only
  // runs on a full load or a fresh server request; a permission revoked
  // mid-session surfaces here instead, on the next background refetch. A
  // generic `<ErrorCard retry>` would offer a "Try again" that fails
  // identically forever. Compare `reports-hub.tsx`.
  if (latest.error?.status === 403) return <ForbiddenScreen />;

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="font-serif text-3xl text-foreground">Insights</h1>
        <p className="text-[13px] text-muted-foreground">
          Your evening digest, written from the day's figures.
        </p>
      </div>
      {/* Not offered while the feature is known to be off: the POST can only
          answer 409, and the message it would then print contradicts the rest
          of this screen. Still offered when `ai` is `null`, because that is
          "unknown", not "off". */}
      {canRun && ai?.enabled !== false ? (
        <RunDigestButton sinceLocalDate={latest.data?.localDate ?? null} />
      ) : null}
    </div>
  );

  // `isPending`, matching `DigestHistory` and `DigestDetail`: the three
  // components on this feature used two predicates between them, and they
  // differ exactly in the paused state React Query's default
  // `networkMode: "online"` produces when the browser reports offline
  // (`isPending: true, isFetching: false, data: undefined, error: null`).
  // `isLoading` there is false, so this screen used to announce "no digest
  // yet" to a shop that has one.
  //
  // `profile` keeps `isLoading` deliberately: `useOrganizationProfile` is
  // disabled until the session reports an organization, and a disabled query
  // reports `isPending: true` for ever — that one would be a skeleton with no
  // end rather than a skeleton with a wrong caption.
  if (latest.isPending || profile.isLoading) {
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
          <DigestView digest={latest.data} />
          <TraceSection digest={latest.data} />
        </>
      ) : (
        <NoDigestYet ai={ai} canConfigure={canRun} />
      )}
      <DigestHistory />
    </div>
  );
}

/**
 * The three things "there is no digest on this screen" can mean.
 *
 * Off, on-but-nothing-has-run-yet, and not-known-yet are genuinely different
 * facts, and only one of them is an instruction to go and change a setting.
 */
function NoDigestYet({
  ai,
  canConfigure,
}: {
  ai: { enabled: boolean; hourLocal: number } | null;
  canConfigure: boolean;
}) {
  if (ai === null) {
    // Neither "it is off" nor "it arrives at 21:00" is known to be true.
    return (
      <EmptyState
        title="No digest yet"
        description="Digests that run overnight, and any you generate yourself, appear here."
      />
    );
  }

  if (!ai.enabled) {
    return (
      <EmptyState
        title="The daily digest is off"
        description={
          canConfigure
            ? "Nothing will arrive until it is switched on."
            : "An owner can switch it on under Settings → AI insights."
        }
        // Omitted entirely for a member without `organization:update`:
        // `/settings` is gated on that permission and enforced server-side
        // (`config/routes.ts`), so the link would land on a ForbiddenScreen.
        action={
          canConfigure ? (
            <ButtonLink href={`${ROUTES.settings}?tab=ai`}>
              Settings → AI insights
            </ButtonLink>
          ) : null
        }
      />
    );
  }

  return (
    <EmptyState
      title="No digest yet"
      description={`Your first one arrives at ${String(ai.hourLocal).padStart(2, "0")}:00 tonight${
        canConfigure ? ", or generate one now" : ""
      }.`}
    />
  );
}
