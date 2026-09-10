import Link from "next/link";
import { ButtonLink } from "@/components/shared/button-link";
import { ROUTES } from "@/config/routes";
import { PanelFigure } from "@/features/dashboard/components/debts-section";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import type { DashboardTeamSection } from "@/features/dashboard/types";

interface TeamSectionProps {
  section: DashboardTeamSection;
}

/**
 * Active and invited members (design canvas artboard `1c`, right of the
 * Announcements/Team band).
 *
 * The section is gated on `members:view` **and** `members:invite` together, so
 * every caller who receives it may act on it — which is why the Invite button
 * is rendered unconditionally here rather than behind another `useCan`.
 */
export function TeamSection({ section }: TeamSectionProps) {
  return (
    <SectionStrip
      title="Team"
      actions={
        <Link
          href={ROUTES.team}
          className="text-xs font-medium text-primary hover:underline"
        >
          Members
        </Link>
      }
      className="flex flex-col"
    >
      <div className="flex flex-1 flex-wrap items-center gap-x-7 gap-y-4 px-[18px] py-4">
        <PanelFigure label="Active" value={String(section.activeCount)} />
        <PanelFigure
          label="Invited"
          value={String(section.invitedCount)}
          tone={
            section.invitedCount > 0 ? "text-warning-strong" : "text-foreground"
          }
        />
        <span className="flex-1" />
        <ButtonLink
          variant="outline"
          className="h-9 rounded-[10px] px-3.5 text-[13px]"
          href={ROUTES.team}
        >
          Invite
        </ButtonLink>
      </div>
    </SectionStrip>
  );
}
