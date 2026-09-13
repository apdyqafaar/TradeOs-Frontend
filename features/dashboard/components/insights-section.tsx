import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/config/routes";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import type { DashboardDigestSection } from "@/features/dashboard/types";
import { formatLocalDate } from "@/lib/format/date";

/**
 * What the strip needs to know about the shop's AI settings, or `null` when
 * it does not know yet.
 *
 * `null` is a real third answer, not a loading nicety: `GET /dashboard`
 * carries no `ai` block on its `organization` section (checked against
 * `Backend/src/services/dashboard/organization.section.ts`), so this comes
 * from `GET /organizations/current`, which is gated on `organization:view` and
 * can 403 for a custom role holding only `reports:view`. The strip must not
 * render "we could not ask" as "it is off".
 */
export interface InsightsAiSettings {
  enabled: boolean;
  hourLocal: number;
}

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
 * the seven hours until the 21:05 cron landed. `ai` settles which of the three
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
  ai = null,
  canConfigureAi = false,
}: {
  section: DashboardDigestSection;
  /** `null` until the organization profile answers — see `InsightsAiSettings`. */
  ai?: InsightsAiSettings | null;
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
          <NoDigestYet ai={ai} canConfigureAi={canConfigureAi} />
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
  ai,
  canConfigureAi,
}: {
  ai: InsightsAiSettings | null;
  canConfigureAi: boolean;
}) {
  if (ai === null) {
    return <Line>No digest yet.</Line>;
  }

  if (!ai.enabled) {
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

  return (
    <Line>
      No digest yet. Your first one arrives at{" "}
      {String(ai.hourLocal).padStart(2, "0")}:00 tonight.
    </Line>
  );
}
