import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Serif, short, a noun phrase — brief §8.4. */
  title: string;
  /** One sentence. Say what would put something here, not that there is nothing. */
  description?: string;
  icon?: LucideIcon;
  /** At most one call to action; omit it entirely when the caller lacks the permission to act. */
  action?: ReactNode;
  className?: string;
}

/**
 * The empty state every list renders. Deliberately quiet: no illustration, no
 * exclamation marks (brief §9), and no border — an empty list should read as a
 * calm absence rather than an error, which is what a bordered card implies.
 *
 * A list that is empty *because of a filter* is a different state and needs a
 * different message plus a "Clear filters" action (brief §8.4); pass those in
 * rather than reusing the unfiltered copy.
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-16 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
      ) : null}
      <p className="font-serif text-xl text-foreground">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
