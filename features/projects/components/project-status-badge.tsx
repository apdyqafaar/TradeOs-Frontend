import { cn } from "cn";
import type { ProjectStatus } from "../types";

/**
 * The five statuses, their labels and their tints.
 *
 * The API's enum is `snake_case` and unlabelled (`project.validation.ts:4`), so
 * the human words live here — one table, used by the badge, the grid's filter
 * and the form's picker, because three copies of "in_progress" → "In progress"
 * is three chances to disagree.
 *
 * **Tokens, never hexes** (CLAUDE.md). The canvas draws the pill with literal
 * colours per status (`{{ p.bg }}` / `{{ p.fg }}` on artboard `2l`); the
 * semantic pairs below are what those colours *are* in this design system, and
 * they carry a dark theme for free — a hex would not. The one deliberate
 * reading: `on_hold` is warning rather than neutral, because a project nobody
 * is working on is a thing to notice, and `cancelled` is destructive-toned
 * without being alarming, because it is a decision rather than a failure.
 */
const STATUS_STYLES: Record<
  ProjectStatus,
  { label: string; className: string }
> = {
  planned: {
    label: "Planned",
    className: "bg-surface-2 text-muted-foreground",
  },
  in_progress: {
    label: "In progress",
    className: "bg-primary-soft text-primary-soft-foreground",
  },
  on_hold: {
    label: "On hold",
    className: "bg-warning-soft text-warning-soft-foreground",
  },
  completed: {
    label: "Completed",
    className: "bg-success-soft text-success-soft-foreground",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-destructive-soft text-destructive-soft-foreground",
  },
};

/** The human word for a status. Exported for the filter and the form picker. */
export const projectStatusLabel = (status: ProjectStatus): string =>
  STATUS_STYLES[status].label;

export interface ProjectStatusBadgeProps {
  status: ProjectStatus;
  /** Adds the small dot the public page's pill carries (artboard `2l`, right). */
  withDot?: boolean;
  className?: string;
}

/**
 * The status pill — artboard `2l`, on the grid cards, the detail header and the
 * public page.
 *
 * A Server Component: it takes a string and renders a span, so there is no
 * reason for it to cost the public page a client bundle.
 */
export function ProjectStatusBadge({
  status,
  withDot,
  className,
}: ProjectStatusBadgeProps) {
  const { label, className: tint } = STATUS_STYLES[status];

  return (
    <span
      className={cn(
        "inline-flex h-[22px] flex-none items-center gap-1.5 rounded-lg px-2 font-medium text-[11px]",
        tint,
        className,
      )}
    >
      {withDot ? (
        <span
          aria-hidden="true"
          // `currentColor`, so the dot follows whichever tint the status picked
          // instead of needing a sixth token per state.
          className="size-1.5 rounded-full bg-current"
        />
      ) : null}
      {label}
    </span>
  );
}
