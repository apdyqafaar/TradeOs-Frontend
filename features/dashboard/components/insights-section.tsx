import { Sparkles } from "lucide-react";
import Link from "next/link";
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
}: {
  section: DashboardDigestSection;
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
          <p className="text-[13px] text-muted-foreground">
            No digest yet.{" "}
            <Link
              href={`${ROUTES.settings}?tab=ai`}
              className="text-primary hover:underline"
            >
              Turn it on under Settings → AI insights
            </Link>
            .
          </p>
        ) : section.status === "failed" || !section.headline ? (
          <p className="text-[13px] text-muted-foreground">
            Last night's digest could not be written.{" "}
            <Link
              href={ROUTES.insights}
              className="text-primary hover:underline"
            >
              Generate one now
            </Link>
            .
          </p>
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
