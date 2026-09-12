import { Pin } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ROUTES } from "@/config/routes";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import type { DashboardAnnouncementsSection } from "@/features/dashboard/types";
import { formatRelative } from "@/lib/format/date";

interface AnnouncementsSectionProps {
  /** The section's value **is** the array — latest three, pinned first. */
  section: DashboardAnnouncementsSection;
  timezone: string;
}

/**
 * The three latest announcements (design canvas artboard `1c`).
 *
 * Every member receives this section — it carries no permission gate at all —
 * so it is the one panel a brand-new business and a Seller both always see.
 */
export function AnnouncementsSection({
  section,
  timezone,
}: AnnouncementsSectionProps) {
  return (
    <SectionStrip
      title="Announcements"
      actions={
        <Link
          href={ROUTES.announcements}
          className="text-xs font-medium text-primary hover:underline"
        >
          View all
        </Link>
      }
    >
      {section.length === 0 ? (
        <EmptyState
          title="Nothing announced yet"
          description="Notices posted to the team appear here."
        />
      ) : (
        <ul className="flex flex-col px-[18px] pt-1 pb-2.5">
          {section.map((announcement) => (
            <li
              key={announcement.id}
              className="flex h-[46px] items-center gap-2.5 border-b border-border/60 last:border-b-0"
            >
              {announcement.pinned ? (
                <Pin
                  className="size-3.5 flex-none text-primary"
                  aria-label="Pinned"
                />
              ) : null}
              {/* The title is the link, matching `<ProjectsSection>`: the
                  Overview is a set of entry points, and a notice you can read
                  three lines of but not open is a dead end. No permission check
                  around it — `announcements:view` is held by every preset, which
                  is why this whole section has no gate either. */}
              <Link
                href={ROUTES.announcement(announcement.id)}
                className="flex-1 truncate text-[13px] text-foreground hover:underline"
              >
                {announcement.title}
              </Link>
              <span className="hidden flex-none text-xs text-muted-foreground sm:inline">
                {announcement.author.name}
              </span>
              <span className="w-[74px] flex-none text-right font-mono text-[11px] text-muted-3">
                {formatRelative(announcement.createdAt, timezone)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionStrip>
  );
}
