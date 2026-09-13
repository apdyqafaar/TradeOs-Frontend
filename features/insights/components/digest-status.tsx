import { cn } from "cn";
import type { DigestStatus } from "@/features/insights/types";

const STATUS_STYLES: Record<DigestStatus, string> = {
  complete: "bg-success-soft text-success-strong",
  partial: "bg-warning-soft text-warning-strong",
  failed: "bg-destructive-soft text-destructive-strong",
};

const STATUS_LABELS: Record<DigestStatus, string> = {
  complete: "Complete",
  partial: "Partial",
  failed: "Failed",
};

/**
 * How a run ended, in a word — spec §11's "`status`/`stoppedBy` shown
 * honestly".
 *
 * One component rather than a copy per screen: the history list labelled every
 * row while the panel above it labelled nothing, so the same digest read
 * "Failed" underneath and carried no status at all in the panel the reader was
 * actually looking at. The label is text, never colour alone.
 */
export function DigestStatusBadge({
  status,
  className,
}: {
  status: DigestStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[20px] flex-none items-center rounded-lg px-2 font-mono text-[10px] uppercase",
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
