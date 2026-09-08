import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ROUTES } from "@/config/routes";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import type { DashboardProjectsSection } from "@/features/dashboard/types";
import { formatDate } from "@/lib/format/date";

interface ProjectsSectionProps {
  section: DashboardProjectsSection;
  timezone: string;
}

/**
 * Projects in progress and the three due soonest (design canvas artboard `1c`,
 * right of the Staff/Projects band).
 *
 * The canvas draws a customer name and a status pill on each row. `dueSoon`
 * carries `{ id, title, dueDate, progress }` and neither of those, so the row
 * is title / due date / progress; see `docs/findings/task-11.md`. The
 * `inProgressCount` the canvas has no place for rides in the header, where it
 * gives the three rows their context — three of nine, or three of three.
 */
export function ProjectsSection({ section, timezone }: ProjectsSectionProps) {
  return (
    <SectionStrip
      title="Projects · due soon"
      info="In-progress projects due within the next 14 days, soonest first."
      actions={
        <>
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            {section.inProgressCount} in progress
          </span>
          <Link
            href={ROUTES.projects}
            className="text-xs font-medium text-primary hover:underline"
          >
            View all
          </Link>
        </>
      }
    >
      {section.dueSoon.length === 0 ? (
        <EmptyState
          title="Nothing due soon"
          description="Projects due in the next two weeks appear here."
        />
      ) : (
        <ul className="flex flex-col px-[18px] pt-1.5 pb-3">
          {section.dueSoon.map((project) => (
            <li
              key={project.id}
              className="flex flex-col gap-2 border-b border-border/60 py-3 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={ROUTES.project(project.id)}
                  className="truncate text-[13px] font-medium text-foreground hover:underline"
                >
                  {project.title}
                </Link>
                <span className="inline-flex h-[22px] flex-none items-center rounded-lg bg-muted px-2 font-mono text-[11px] font-medium text-muted-foreground">
                  {formatDate(project.dueDate, timezone)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-1.5 rounded-full bg-primary"
                    style={{
                      // 0-100 from the API; clamped so a bad row cannot draw a
                      // bar wider than its track.
                      width: `${Math.min(100, Math.max(0, project.progress))}%`,
                    }}
                  />
                </span>
                <span className="w-9 flex-none text-right font-mono text-[11px] text-foreground">
                  {Math.round(project.progress)}%
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionStrip>
  );
}
