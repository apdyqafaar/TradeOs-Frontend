"use client";

import { useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/features/auth/hooks/use-permission";
import { DigestHistory } from "@/features/insights/components/digest-history";
import {
  DigestOffPanel,
  GeneratingSkeleton,
  NoDigestYetPanel,
} from "@/features/insights/components/digest-states";
import { DigestView } from "@/features/insights/components/digest-view";
import {
  CustomRangeFields,
  PeriodControl,
} from "@/features/insights/components/period-control";
import { RunDigestButton } from "@/features/insights/components/run-digest-button";
import { TraceSection } from "@/features/insights/components/trace-section";
import {
  useDigestQuota,
  useLatestDigest,
} from "@/features/insights/hooks/use-digests";
import {
  DIGEST_PERIOD_SENTENCE,
  defaultCustomRange,
  formatDigestPeriod,
} from "@/features/insights/lib/period";
import type {
  DigestPeriodPreset,
  RunDigestInput,
} from "@/features/insights/types";
import { useCurrencyConfig } from "@/features/organization/hooks/use-currency-config";
import { useOrganizationProfile } from "@/features/organization/hooks/use-organization-profile";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatLocalDate, formatTime } from "@/lib/format/date";

/**
 * `/insights` — the evening digest, written from the day's figures.
 *
 * The permission that runs a digest is `organization:update`
 * (`docs/API-ROUTES.md`, `POST /digests/run`), the same one that gates the
 * settings screen the digest is configured from — generating one is a write on
 * the organization's AI usage, not a read of its reports. **Reading the
 * allowance is `reports:view`**, which is why the quota line appears for a
 * viewer who can never press Generate.
 *
 * A 404 on `latest` is "no digest yet", an answer rather than a failure
 * (`useLatestDigest`'s own `retry: false`), so it renders the empty state
 * rather than the error card.
 *
 * **"No digest yet" is three different states, and this screen used to
 * conflate them.** `ai.enabled` defaults to `false`, so every tenant starts
 * with the feature switched off — and this screen once read `ai.hourLocal`
 * without ever reading `ai.enabled`, telling those shops their first digest
 * arrived at 21:00 tonight and offering a Generate button whose only possible
 * answer was `409 AI_DISABLED_FOR_ORGANIZATION`. The Overview strip
 * (`features/dashboard/components/insights-section.tsx`) renders the same three
 * from the same `ai.enabled`, so the two screens cannot contradict each other.
 */
export function InsightsScreen() {
  const latest = useLatestDigest();
  const profile = useOrganizationProfile();
  const quota = useDigestQuota();
  const currency = useCurrencyConfig();
  const canRun = useCan(PERMISSIONS.ORGANIZATION_UPDATE);

  // The window the NEXT run covers. Local state, not `nuqs`: this is an input
  // to a mutation, not a filter on what is displayed — `GET /digests/latest`
  // takes no period and answers with the most recent digest whatever window it
  // covered — so there is nothing here to make shareable in a URL.
  const [preset, setPreset] = useState<DigestPeriodPreset>("today");
  // True for the ~minute a run takes, reported up by the button that owns the
  // wait. It only changes what a shop with NOTHING to read sees: a re-run over
  // an existing digest leaves that digest on screen and puts the progress in
  // the button, because blanking a page the reader is already reading to show
  // them an outline of it is the worse trade.
  const [generating, setGenerating] = useState(false);

  // `latest.data?.timezone` is the zone THAT digest was written in; the profile
  // carries the shop's current one. The fallback order matters on the empty
  // screen, where there is no digest to take a zone from.
  const timezone = latest.data?.timezone ?? profile.data?.timezone ?? "UTC";
  const [range, setRange] = useState(() => defaultCustomRange(timezone));

  // `null` — not `false` — when the profile could not be read: a role holding
  // `reports:view` but not `organization:view` gets a 403 here, and "we do not
  // know" must not be rendered as "it is off".
  const ai = profile.data?.ai ?? null;

  // Nothing broke — the caller simply may not read this any more.
  // `requirePageAccess` already gated the route server-side, but that only
  // runs on a full load or a fresh server request; a permission revoked
  // mid-session surfaces here instead, on the next background refetch.
  if (latest.error?.status === 403) return <ForbiddenScreen />;

  const period: RunDigestInput =
    preset === "custom"
      ? { preset, from: range.from, to: range.to }
      : { preset };

  // Not offered while the feature is known to be off: the POST can only answer
  // 409, and the message it would then print contradicts the rest of this
  // screen. Nor while the profile is still in flight — `ai === null` means both
  // "the profile 403'd" and "it has not arrived yet", and offering the button
  // during the second lets an owner of an AI-off shop click Generate, get the
  // 409, and read "Turn on the daily digest in Settings first" beside a screen
  // that then resolves to "the digest is off".
  //
  // `isLoading`, not `isPending`: this query is disabled until the session
  // reports an organization, where `isPending` stays true for ever and would
  // hide the button permanently.
  const offerRun = canRun && !profile.isLoading && ai?.enabled !== false;
  const runButton = offerRun ? (
    <RunDigestButton
      sinceLocalDate={latest.data?.localDate ?? null}
      period={period}
      quota={quota}
      onWaitingChange={setGenerating}
    />
  ) : null;

  /**
   * **Exactly one Generate control on the page, ever.**
   *
   * Two would not merely look redundant: each `RunDigestButton` owns its own
   * `pending` state and its own give-up timer, so a second one would sit at
   * "Generate now" while the first said "Generating 0:23" about the same run,
   * and the quota line would be printed twice.
   *
   * Which one renders follows the artboards: with a digest on screen it lives
   * in the header beside the period control (`1a`), and with no digest — or a
   * failed one — it lives inside the panel that is explaining why, where the
   * reader is actually looking (`1e`).
   */
  const inHeader = Boolean(latest.data) && latest.data?.status !== "failed";
  const headerAction = inHeader ? runButton : null;
  const panelAction = inHeader ? null : runButton;

  const digestPeriod = formatDigestPeriod(latest.data?.period, timezone);
  const subline = latest.data
    ? [
        // The period the digest covers, when the row carries one; otherwise
        // the day it was written, which is the only window an older row knows.
        digestPeriod ?? formatLocalDate(latest.data.localDate),
        `written ${formatTime(latest.data.generatedAt, latest.data.timezone)}`,
        latest.data.timezone,
      ].join(" · ")
    : null;

  const header = (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          {/* text-[32px] leading-[1.1], not text-3xl: every other page title in
              the app is set this way, and Tailwind's text-3xl is 30px with a
              36px line-height, which reads looser and sits a size off. */}
          <h1 className="font-serif text-[32px] text-foreground leading-[1.1]">
            Insights
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {subline ?? "Your evening digest, written from the day's figures."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {offerRun ? (
            <PeriodControl value={preset} onChange={setPreset} />
          ) : null}
          {headerAction}
        </div>
      </div>
      {offerRun && preset === "custom" ? (
        <CustomRangeFields
          from={range.from}
          to={range.to}
          onChange={setRange}
        />
      ) : null}
    </header>
  );

  // `isPending`, matching `DigestHistory` and `DigestDetail`: the three
  // components on this feature used two predicates between them, and they
  // differ exactly in the paused state React Query's default
  // `networkMode: "online"` produces when the browser reports offline
  // (`isPending: true, isFetching: false, data: undefined, error: null`).
  // `isLoading` there is false, so this screen used to announce "no digest
  // yet" to a shop that has one.
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
    <div className="flex flex-col gap-7">
      {header}
      {latest.data ? (
        <>
          <DigestView
            digest={latest.data}
            currency={currency.mainCurrency}
            action={panelAction}
          />
          <TraceSection digest={latest.data} />
        </>
      ) : generating ? (
        // Named subject, not a spinner: "Reading sales, debts, stock and
        // projects for the last 7 days" is the difference between a minute
        // that feels like progress and a minute that feels like a hang.
        <GeneratingSkeleton
          subject={`sales, debts, stock and projects for ${DIGEST_PERIOD_SENTENCE[preset]}`}
        />
      ) : ai !== null && !ai.enabled ? (
        <DigestOffPanel canConfigure={canRun} />
      ) : (
        <NoDigestYetPanel
          hourLocal={ai?.hourLocal ?? null}
          action={panelAction}
        />
      )}
      <DigestHistory />
    </div>
  );
}
