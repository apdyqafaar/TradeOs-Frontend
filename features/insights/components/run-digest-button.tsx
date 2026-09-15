"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  quotaFromRefusal,
  useLatestDigest,
  useRunDigest,
} from "@/features/insights/hooks/use-digests";
import type { DigestQuota, RunDigestInput } from "@/features/insights/types";
import { API_ERROR_CODE } from "@/lib/api/errors";

const POLL_MS = 5_000;
const GIVE_UP_MS = 120_000;
const TICK_MS = 1_000;

/**
 * A run in flight, and the digest that was on screen when it was asked for.
 *
 * Both identity fields are server-issued strings compared for inequality, not
 * ordered or parsed — this is deliberately not a timestamp comparison. A
 * manual run upserts the row for the same `localDate` (spec §5), so `id` can
 * legitimately stay the same across a successful run and only `generatedAt`
 * moves; either changing means the server has written something new.
 */
interface PendingRun {
  localDate: string;
  /** `null` when the shop had no digest at all when the run was asked for. */
  previousId: string | null;
  previousGeneratedAt: string | null;
}

/**
 * Posts `/digests/run`, then polls `latest` every 5s for up to two minutes —
 * the run itself takes about a minute (Backend spec §11). The daily allowance
 * is the server's; its refusal is shown where the click happened, never
 * swallowed into a toast.
 *
 * **Success is never decided against the browser's clock.** It used to be:
 * `latest.data.generatedAt > new Date(startedAt).toISOString()` where
 * `startedAt = Date.now()` on the client. No NTP is the norm on a shop counter
 * PC in this market, and both directions of skew broke it — a clock ten
 * minutes fast never recognised success (the new digest already rendered above
 * while this button still said "Generating…", then "taking longer than
 * expected"), and a slow one reported success on the first poll against a
 * pre-existing row for the same day. Comparing the digest now on screen to the
 * one that was on screen at click time is two server values and no local
 * clock.
 *
 * The elapsed counter beside "Generating" is the one number here that IS local
 * — it counts its own ticks rather than differencing `Date.now()`, so a clock
 * adjusted mid-run cannot make it jump backwards or leap ahead. It decides
 * nothing; it is there because a minute of silence on a slow connection reads
 * as a broken button.
 */
export function RunDigestButton({
  sinceLocalDate,
  period,
  quota,
  onWaitingChange,
}: {
  sinceLocalDate: string | null;
  /** The window the next run should cover. `{}` means today, as the API's own default does. */
  period?: RunDigestInput;
  /**
   * The allowance, rendered beneath the button. `null` while it is unknown —
   * in which case **nothing is rendered**, because "0 of 0 left today" reads
   * as a spent allowance rather than an unanswered question.
   */
  quota?: DigestQuota | null;
  /**
   * Told when the roughly-one-minute wait starts and ends, so the page can put
   * a skeleton of the content that is coming where an empty state used to be.
   *
   * A callback rather than the state living upstairs: the wait is decided by
   * two server values this component holds and polls for, and lifting that
   * decision into the screen would move the one piece of logic on this feature
   * that has already been got wrong twice.
   */
  onWaitingChange?: (waiting: boolean) => void;
}) {
  const run = useRunDigest();
  const [pending, setPending] = useState<PendingRun | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const latest = useLatestDigest({ pollMs: pending ? POLL_MS : undefined });

  // Success only: this genuinely is caused by new data arriving, so a
  // dependency-driven effect is the right tool for it.
  useEffect(() => {
    if (!pending) return;
    const current = latest.data;
    if (!current || current.localDate !== pending.localDate) return;
    const unchanged =
      current.id === pending.previousId &&
      current.generatedAt === pending.previousGeneratedAt;
    if (unchanged) return;
    setPending(null);
  }, [pending, latest.data]);

  // The give-up deadline, on the other hand, is NOT caused by anything
  // changing — its whole job is to fire when nothing has. A run that never
  // actually produces a digest (a backend timeout or crash after the 202)
  // leaves `latest.data` at the same `undefined` reference forever, so a
  // check living inside the effect above would never be re-evaluated after
  // the (near-zero-elapsed) run right after the click. A real timer fires on
  // its own clock regardless of whether anything else re-renders, and the
  // cleanup guarantees it cannot fire after success already cleared
  // `pending`, or after the component unmounts.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      setPending(null);
      setTimedOut(true);
    }, GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  // Reported to the parent from an effect rather than from the click handler
  // and the success effect separately: the wait ends in three different places
  // (the digest landing, the give-up timer, an unmount), and one effect keyed
  // on the state itself cannot miss one of them.
  const waiting = Boolean(pending);
  useEffect(() => {
    onWaitingChange?.(waiting);
  }, [waiting, onWaitingChange]);

  // Counts its own ticks rather than differencing wall-clock time, for the
  // reason the docblock gives. Cleared by the same `pending` transition that
  // ends the wait, so it always starts a new run at 0:00.
  useEffect(() => {
    if (!pending) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(
      () => setElapsed((seconds) => seconds + 1),
      TICK_MS,
    );
    return () => clearInterval(timer);
  }, [pending]);

  const refusedQuota = quotaFromRefusal(run.error);
  const message = run.error
    ? run.error.code === API_ERROR_CODE.DIGEST_QUOTA_EXHAUSTED
      ? // The refusal's own numbers, never a literal: the allowance is
        // `AI_MANUAL_RUNS_PER_DAY` and it defaults to 2, not to the 3 the
        // canvas was drawn against, and a deployment may tune it.
        `You've used ${refusedQuota ? `today's ${refusedQuota.limit} manual ${refusedQuota.limit === 1 ? "run" : "runs"}` : "today's manual runs"}. The evening digest still arrives on schedule.`
      : run.error.code === API_ERROR_CODE.TOO_MANY_REQUESTS
        ? // A DIFFERENT 429 on the same route: the loop shield, not the daily
          // allowance. Branching on the status alone would tell an owner with
          // runs in hand that they had spent them.
          "That was too quick after the last one. Try again in a moment."
        : run.error.code === API_ERROR_CODE.AI_DISABLED_FOR_ORGANIZATION
          ? "Turn on the daily digest in Settings → AI insights first."
          : run.error.code === API_ERROR_CODE.AI_NOT_CONFIGURED
            ? // 503: the SERVER has no AI provider. Nothing the owner can fix,
              // so it does not point them at a setting.
              "AI insights are not set up on this server yet."
            : run.error.code === API_ERROR_CODE.PERIOD_TOO_LONG
              ? "That range is longer than a year. Pick a shorter one — this did not cost you a run."
              : run.error.code === API_ERROR_CODE.INVALID_PERIOD ||
                  run.error.code === API_ERROR_CODE.INVALID_DATE
                ? "Check those two dates. Nothing was generated and this did not cost you a run."
                : run.error.message
    : pending
      ? "Generating… this takes about a minute."
      : timedOut
        ? // Not worded as a failure — the POST succeeded and the run may
          // still be going server-side; only the two-minute wait ended.
          "This is taking longer than expected. It may still arrive — tonight's automatic run is unaffected either way."
        : null;

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <Button
        type="button"
        size="lg"
        disabled={run.isPending || Boolean(pending)}
        onClick={() => {
          setTimedOut(false);
          // Captured here, before the mutation's own `onSuccess` invalidates
          // `latest` and a refetch can land: this is the digest the reader
          // was looking at when they asked for a new one.
          const before = latest.data ?? null;
          run.mutate(period ?? {}, {
            onSuccess: ({ localDate }) => {
              setPending({
                localDate,
                previousId: before?.id ?? null,
                previousGeneratedAt: before?.generatedAt ?? null,
              });
            },
          });
        }}
      >
        {pending ? (
          <>
            <span
              aria-hidden
              className="size-[15px] animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground"
            />
            Generating
            <span className="font-mono text-[12px] opacity-80">
              {formatElapsed(elapsed)}
            </span>
          </>
        ) : (
          <>
            <Sparkles className="size-[15px]" aria-hidden />
            {sinceLocalDate ? "Generate again" : "Generate now"}
          </>
        )}
      </Button>
      <QuotaLine quota={quota ?? null} />
      {message ? (
        <output className="max-w-[46ch] text-muted-foreground text-xs sm:text-right">
          {message}
        </output>
      ) : null}
    </div>
  );
}

/** `0:23`, `1:04` — mm:ss, so a minute reads as a minute. */
function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * "1 of 2 left today".
 *
 * **Both numbers come from the server.** The canvas draws "2 of 3", which was
 * true of the old in-memory limiter and is not true of the shipped default of
 * 2 — and any deployment can tune `AI_MANUAL_RUNS_PER_DAY`, so a literal is
 * wrong in more than one way at once.
 *
 * Renders nothing at all when the quota is unknown. "0 of 0 left today" is the
 * failure mode worth avoiding: it is indistinguishable from a spent allowance.
 */
export function QuotaLine({ quota }: { quota: DigestQuota | null }) {
  if (!quota) return null;
  return (
    <span className="font-mono text-[11px] text-muted-foreground">
      {quota.remaining} of {quota.limit} left today
      {quota.remaining === 0 ? " · back after midnight" : ""}
    </span>
  );
}
