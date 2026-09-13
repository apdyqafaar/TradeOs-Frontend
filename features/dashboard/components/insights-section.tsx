import { Sparkles } from "lucide-react";
import Link from "next/link";
import { ROUTES } from "@/config/routes";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import type { DashboardDigestSection } from "@/features/dashboard/types";
import { formatDate } from "@/lib/format/date";

/**
 * One line from last night's digest, and the way in.
 *
 * It links to `/insights` rather than to the digest's own id: "last night's"
 * is what the reader wants, and that page always opens on the latest one, so
 * the link stays right tomorrow without the strip knowing anything new.
 *
 * A failed night says so. The alternative — rendering nothing — reads as "no
 * digest was due", which is a different and untrue statement.
 */
export function InsightsSection({
  section,
  timezone,
}: {
  section: DashboardDigestSection;
  timezone: string;
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
          Open
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
            No digest yet. Turn it on under Settings → AI insights.
          </p>
        ) : section.headline ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link
              href={ROUTES.insights}
              className="truncate text-[13px] font-medium text-foreground hover:underline"
            >
              {section.headline}
            </Link>
            <span className="font-mono text-[11px] text-muted-3">
              {formatDate(section.localDate, timezone)}
              {section.status === "partial" ? " · partial" : ""}
            </span>
          </div>
        ) : (
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
        )}
      </div>
    </SectionStrip>
  );
}
