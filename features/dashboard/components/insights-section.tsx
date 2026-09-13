import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/config/routes";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import type { DashboardDigestSection } from "@/features/dashboard/types";
import { formatLocalDate } from "@/lib/format/date";

/**
 * One line from last night's digest, and the way in.
 *
 * It links to `/insights` rather than to the digest's own id: "last night's"
 * is what the reader wants, and that page always opens on the latest one, so
 * the link stays right tomorrow without the strip knowing anything new.
 *
 * A failed night says so — decided from `status`, never from `headline` being
 * empty. Nothing yet enforces that the two always agree: the digest
 * orchestrator that assigns `status` is a separate, later task, so a `status`
 * of `"failed"` with a stray `headline` (or the reverse) cannot be ruled out
 * today. The alternative to saying so — rendering nothing — reads as "no
 * digest was due," which is a different and untrue statement.
 *
 * **`section === null` means "no digest row", not "the feature is off."**
 * `Backend/src/services/dashboard/digest.section.ts:14` returns `null`
 * whenever no digest exists, regardless of `ai.enabled`, so this strip used to
 * tell a shop that had enabled the digest at 14:00 to go and enable it — for
 * the seven hours until the 21:05 cron landed. `aiEnabled` settles which of the three
 * it is, and `features/insights/components/insights-screen.tsx` renders the
 * same three states from the same field so the two screens cannot disagree.
 *
 * No `timezone` prop, deliberately: `section.localDate` is a bare
 * `yyyy-MM-dd` the server already resolved in the shop's own timezone, not an
 * instant, so `formatLocalDate` renders it with no timezone conversion of any
 * kind — see that function's docblock in `lib/format/date.ts` for why routing
 * it through `formatDate` instead silently prints the day before for a shop
 * west of Greenwich. Dropping the parameter here (rather than accepting and
 * ignoring one) makes that regression a compile error, not just a bug someone
 * could reintroduce quietly.
 */
export function InsightsSection({
  section,
  aiEnabled = null,
  canConfigureAi = false,
}: {
  section: DashboardDigestSection;
  /**
   * `sections.organization.ai.enabled` — it rides along on `GET /dashboard`,
   * so the strip costs no second request.
   *
   * `null` means "not known", and on this screen that is **not** a permission
   * outcome and not a loading one either. `organization` needs no permission
   * and is built for every caller, `/dashboard` is itself gated
   * `organization:view` (`Backend/src/routes/v1/dashboard.route.ts`) so
   * everyone who reaches the strip holds it, and `Overview` does not render
   * this component at all until the response has arrived. What is left is
   * deploy skew: an API build older than the one that added the field
   * (`Backend` a7a365e). The type says it is always there and the backend
   * pins it with two tests; this branch is what keeps a stale API a quiet
   * "No digest yet." instead of a confident, wrong "it is off".
   *
   * `/insights` reads the same fact from `GET /organizations/current`
   * instead, because it also needs `hourLocal` to name the arrival hour —
   * which this section deliberately does not carry.
   */
  aiEnabled?: boolean | null;
  /**
   * `organization:update`. Defaults to `false`: a control the viewer cannot
   * use is worse than no control, so the link is opt-in rather than opt-out.
   */
  canConfigureAi?: boolean;
}) {
  return (
    <SectionStrip
      title="Insights · last night"
      info="Written each evening by the AI analysts from that day's sales, debts, stock and projects."
      actions={
        <Link
          href={ROUTES.insights}
          className="text-xs font-medium text-primary hover:underline"
        >
          All insights
        </Link>
      }
    >
      <div className="flex items-start gap-3 px-[18px] py-3">
        <Sparkles
          className="mt-0.5 size-4 flex-none text-primary"
          aria-hidden="true"
        />
        {section === null ? (
          <NoDigestYet aiEnabled={aiEnabled} canConfigureAi={canConfigureAi} />
        ) : section.status === "failed" || !section.headline ? (
          <Line>
            Last night's digest could not be written.{" "}
            <InsightsLink>Open Insights</InsightsLink>.
          </Line>
        ) : (
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link
              href={ROUTES.insights}
              className="truncate text-[13px] font-medium text-foreground hover:underline"
            >
              {section.headline}
            </Link>
            <span className="font-mono text-[11px] text-muted-3">
              {formatLocalDate(section.localDate)}
              {section.status === "partial" ? " · partial" : ""}
            </span>
          </div>
        )}
      </div>
    </SectionStrip>
  );
}

function Line({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

/**
 * The link into `/insights`, named after where it goes.
 *
 * It used to read "Generate one now", which promised an action it does not
 * perform, named no destination for a screen-reader user listing the page's
 * links, and dead-ended a `reports:view`-only role at a page with no Generate
 * control on it. `section-links.test.tsx` polices exactly this shape.
 */
function InsightsLink({ children }: { children: ReactNode }) {
  return (
    <Link href={ROUTES.insights} className="text-primary hover:underline">
      {children}
    </Link>
  );
}

function NoDigestYet({
  aiEnabled,
  canConfigureAi,
}: {
  aiEnabled: boolean | null;
  canConfigureAi: boolean;
}) {
  if (aiEnabled === null) {
    return <Line>No digest yet.</Line>;
  }

  if (!aiEnabled) {
    return (
      <Line>
        The daily digest is off.{" "}
        {canConfigureAi ? (
          <>
            Turn it on under{" "}
            {/* Gated on `organization:update`: `/settings` is gated on it in
                `config/routes.ts` and enforced server-side, so offering this
                to a `reports:view`-only member sends them to a
                ForbiddenScreen. They get the sentence without the link. */}
            <Link
              href={`${ROUTES.settings}?tab=ai`}
              className="text-primary hover:underline"
            >
              Settings → AI insights
            </Link>
            .
          </>
        ) : (
          "An owner can switch it on under Settings → AI insights."
        )}
      </Line>
    );
  }

  // No hour named here, deliberately: `organization.ai` carries only
  // `enabled`, so the exact time is not on this screen's payload and guessing
  // it would be another confident, wrong sentence. "Closing hour" is what
  // Settings calls the field the run follows, so that is what this calls it;
  // `/insights` names the hour itself, one click away.
  return <Line>No digest yet. Tonight's arrives after your closing hour.</Line>;
}
