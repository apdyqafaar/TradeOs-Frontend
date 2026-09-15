import { Moon, Settings2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { DigestStatusBadge } from "@/features/insights/components/digest-status";
import type { Digest } from "@/features/insights/types";

/**
 * The four screens `/insights` shows when there is no digest to read — artboard
 * `1e`.
 *
 * They are four distinct facts and the page used to have two of them. "The
 * feature is off", "it has not run yet", "it ran and failed", and "it is
 * running now" call for four different sentences and exactly one of them is an
 * instruction to go and change a setting.
 */

/**
 * A run that wrote nothing.
 *
 * The one thing this must get across is that **the shop's own data is
 * untouched** — an owner who reads "failed" on a screen about their sales has
 * every reason to wonder whether the sales are gone. Only the summary is
 * missing.
 *
 * `failureMode` is what makes the closing promise honest, and it is a field the
 * frontend used to drop on the floor. `systematic` means every agent was given
 * its full allowance and none ever produced a readable reply, so promising that
 * "tonight's automatic run is unaffected" would be a fourth guess at a
 * fourth failure; `transient` means the provider had a moment, which the
 * scheduled run genuinely will not repeat.
 */
export function DigestFailedPanel({
  digest,
  action,
}: {
  digest: Digest;
  /** The Generate control, when this viewer may press it. */
  action?: ReactNode;
}) {
  const systematic = digest.failureMode === "systematic";

  return (
    <section className="flex flex-col gap-3.5 rounded-[10px] border border-border bg-card p-7">
      <DigestStatusBadge status="failed" size="md" className="self-start" />
      <h2 className="font-serif text-[26px] text-foreground text-pretty leading-[1.2]">
        Tonight's digest was not written.
      </h2>
      <p className="max-w-[60ch] text-[14px] text-muted-foreground text-pretty leading-[1.6]">
        The analysts started and stopped before any section finished. Your
        sales, debts and stock are untouched — only the summary is missing.
      </p>

      {digest.errors.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {digest.errors.map((entry, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: one entry per section that did not submit, carrying no id; the same section can appear more than once and the list is never reordered independently of the digest.
              key={index}
              className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] leading-relaxed"
            >
              <span className="font-medium text-foreground">
                {entry.section}
              </span>
              <span className="text-muted-foreground">— {entry.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {action}
        <span className="flex-1" />
        {/* The canvas prints a "Request ID". A stored digest has none — that
            header belongs to an HTTP call, and this row was written by a
            background job hours ago. Its own id is what support would ask for,
            so it is labelled as what it actually is. */}
        <span className="font-mono text-[10px] text-muted-3">
          Digest ID {digest.id}
        </span>
      </div>

      <p className="text-[13px] text-muted-foreground">
        {systematic
          ? "Every analyst was given its full allowance and none answered, so generating again tonight is unlikely to help."
          : "Tonight's automatic run is unaffected."}
      </p>
    </section>
  );
}

/**
 * The feature is on and nothing has run yet.
 *
 * On the page ground rather than in a card, as the build note asks: an empty
 * state boxed in a border reads as an error, and nothing has gone wrong.
 */
export function NoDigestYetPanel({
  hourLocal,
  action,
}: {
  /** `ai.hourLocal`, or `null` when the AI settings could not be read. */
  hourLocal: number | null;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="mb-1.5 flex size-[52px] items-center justify-center rounded-xl border border-border bg-muted">
        <Moon className="size-[22px] text-muted-foreground" aria-hidden />
      </span>
      <h2 className="font-serif text-[26px] text-foreground leading-[1.2]">
        {hourLocal === null
          ? // Neither "it is off" nor an arrival time is known to be true, so
            // the heading claims neither. A `reports:view`-only role gets a 403
            // from `GET /organizations/current` and lands here.
            "No digest yet."
          : `Tonight's digest arrives at ${String(hourLocal).padStart(2, "0")}:00.`}
      </h2>
      <p className="max-w-[46ch] text-[14px] text-muted-foreground text-pretty leading-[1.6]">
        The analysts read the whole day after closing. You can generate one now
        for the day so far.
      </p>
      {action ? <div className="mt-2 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * The shop switched the digest off — `ai.enabled === false`, which is the
 * **default for every new organization**, so this is not an edge case.
 *
 * The link is omitted entirely for a member without `organization:update`:
 * `/settings` is gated on it and enforced server-side, so offering it would
 * send them to a ForbiddenScreen.
 */
export function DigestOffPanel({ canConfigure }: { canConfigure: boolean }) {
  return (
    <div className="flex items-start gap-3.5 rounded-[10px] border border-border bg-card p-5">
      <span className="flex size-[34px] flex-none items-center justify-center rounded-[9px] bg-muted">
        <Settings2 className="size-[17px] text-muted-foreground" aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-serif text-[22px] text-foreground leading-[1.2]">
          The evening digest is off for this shop.
        </h2>
        <p className="max-w-[56ch] text-[13px] text-muted-foreground text-pretty leading-[1.6]">
          Nothing is read or written while it is off.{" "}
          {canConfigure ? (
            <>
              Turn it on in{" "}
              <Link
                href={`${ROUTES.settings}?tab=ai`}
                className="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Settings → AI insights
              </Link>{" "}
              and the next evening run will go ahead.
            </>
          ) : (
            "An owner can switch it on under Settings → AI insights."
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * A run in flight with nothing on screen yet — the shape of the content that
 * is coming, not a spinner in the middle of an empty page.
 *
 * Rendered **only when there is no digest to read**. A re-run over an existing
 * digest leaves that digest on screen and puts the progress in the button:
 * blanking a page the reader was already reading, to show them an outline of
 * it, is a worse trade.
 */
export function GeneratingSkeleton({ subject }: { subject: string }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p className="font-mono text-[11px] text-muted-foreground">
        Reading {subject}. Usually under a minute.
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {["80%", "62%", "70%", "40%"].map((width) => (
          <div
            key={width}
            className="flex flex-col gap-3 rounded-[10px] border border-border bg-card px-[18px] py-4"
          >
            <Skeleton className="h-[9px] w-[70px] rounded-[4px]" />
            <Skeleton className="h-[22px] rounded-[5px]" style={{ width }} />
            <Skeleton className="mt-1.5 h-2 w-[90px] rounded-[4px]" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="flex flex-col gap-3.5 rounded-[10px] border border-border bg-card px-5 py-[18px]">
          <Skeleton className="h-[9px] w-[140px] rounded-[4px]" />
          {["92%", "78%", "85%"].map((width) => (
            <Skeleton
              key={width}
              className="h-3.5 rounded-[5px]"
              style={{ width }}
            />
          ))}
        </div>
        <div className="flex flex-col gap-3.5 rounded-[10px] border border-border bg-card px-5 py-[18px]">
          <Skeleton className="h-[9px] w-[110px] rounded-[4px]" />
          <div className="flex h-[70px] items-end gap-2">
            {["40%", "65%", "30%", "80%", "55%", "90%", "70%"].map((height) => (
              <Skeleton
                key={height}
                className="flex-1 rounded-t-[4px] rounded-b-none"
                style={{ height }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
