import { cn } from "cn";
import type {
  DigestStatus,
  DigestVerdict,
  RecommendationAction,
} from "@/features/insights/types";

/**
 * The three pills this page puts words in: how the run ended, what the advisor
 * made of the day, and how urgent one action is.
 *
 * All three are **text first**. Colour is emphasis on a word that is already
 * there, never the thing that carries the meaning — WCAG 1.4.1, and the
 * specific defect this feature shipped once: a pill whose text was
 * `action.kind` and whose colour was `action.priority`, so `{high, chase}` and
 * `{low, chase}` announced identically to a screen reader and differed only in
 * hue on the one card whose entire purpose is ranking tomorrow's work.
 */

/** Soft tint behind, `-strong` text on it, and the dot in the full tone. */
const PILL_BASE =
  "inline-flex flex-none items-center gap-1.5 rounded-lg px-2.5 font-medium";

const STATUS_STYLES: Record<DigestStatus, { pill: string; dot: string }> = {
  complete: { pill: "bg-success-soft text-success-strong", dot: "bg-success" },
  partial: { pill: "bg-warning-soft text-warning-strong", dot: "bg-warning" },
  failed: {
    pill: "bg-destructive-soft text-destructive-strong",
    dot: "bg-destructive",
  },
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
 * actually looking at.
 *
 * `size="sm"` is the history row's 22px pill; `"md"` is the 24px one beside
 * the verdict at the top of the page (canvas `1a`).
 */
export function DigestStatusBadge({
  status,
  size = "sm",
  className,
}: {
  status: DigestStatus;
  size?: "sm" | "md";
  className?: string;
}) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        PILL_BASE,
        size === "md" ? "h-6 text-xs" : "h-[22px] text-[11px]",
        style.pill,
        className,
      )}
    >
      <span
        className={cn("size-1.5 flex-none rounded-full", style.dot)}
        aria-hidden="true"
      />
      {STATUS_LABELS[status]}
    </span>
  );
}

const VERDICT_STYLES: Record<DigestVerdict, { pill: string; dot: string }> = {
  good: { pill: "bg-success-soft text-success-strong", dot: "bg-success" },
  mixed: { pill: "bg-warning-soft text-warning-strong", dot: "bg-warning" },
  poor: {
    pill: "bg-destructive-soft text-destructive-strong",
    dot: "bg-destructive",
  },
  // A quiet day is not a bad one. The shop was open, little happened, and
  // dressing that in amber would turn an ordinary Sunday into a warning.
  quiet: { pill: "bg-muted text-muted-foreground", dot: "bg-muted-3" },
};

const VERDICT_LABELS: Record<DigestVerdict, string> = {
  good: "Good day",
  mixed: "Mixed day",
  poor: "Poor day",
  quiet: "Quiet day",
};

/**
 * The advisor's reading of the day, and **only ever the advisor's**.
 *
 * Rendered from `sections.recommendations.verdict`; when that is absent the
 * caller shows `DigestStatusBadge` instead, which is a fact about the run
 * rather than a judgement about the shop. See `verdictOf` for why nothing here
 * derives one from the figures.
 */
export function VerdictPill({
  verdict,
  className,
}: {
  verdict: DigestVerdict;
  className?: string;
}) {
  const style = VERDICT_STYLES[verdict];
  return (
    <span className={cn(PILL_BASE, "h-6 text-xs", style.pill, className)}>
      <span
        className={cn("size-1.5 flex-none rounded-full", style.dot)}
        aria-hidden="true"
      />
      {VERDICT_LABELS[verdict]}
    </span>
  );
}

const PRIORITY_STYLES: Record<RecommendationAction["priority"], string> = {
  high: "border-destructive-soft bg-destructive-soft text-destructive-strong",
  medium: "border-warning-soft bg-warning-soft text-warning-strong",
  // Low is an outline rather than a third tint, exactly as the canvas draws
  // it: three filled colours in one column reads as three alarms.
  low: "border-border-strong bg-transparent text-muted-foreground",
};

const PRIORITY_LABELS: Record<RecommendationAction["priority"], string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** The priority, as a word, on every action row. Never colour alone. */
export function PriorityPill({
  priority,
}: {
  priority: RecommendationAction["priority"];
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] flex-none items-center rounded-lg border px-2 font-medium font-mono text-[10px] uppercase tracking-[0.06em]",
        PRIORITY_STYLES[priority],
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
