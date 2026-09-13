"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  useLatestDigest,
  useRunDigest,
} from "@/features/insights/hooks/use-digests";
import { API_ERROR_CODE } from "@/lib/api/errors";

const POLL_MS = 5_000;
const GIVE_UP_MS = 120_000;

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
 * the run itself takes about a minute (Backend spec §11). The three-a-day
 * limit is the server's; a 429 is shown where the click happened, never
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
 */
export function RunDigestButton({
  sinceLocalDate,
}: {
  sinceLocalDate: string | null;
}) {
  const run = useRunDigest();
  const [pending, setPending] = useState<PendingRun | null>(null);
  const [timedOut, setTimedOut] = useState(false);
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

  const message = run.error
    ? run.error.code === API_ERROR_CODE.TOO_MANY_REQUESTS
      ? "You've used today's three manual runs. The evening digest still arrives on schedule."
      : run.error.code === API_ERROR_CODE.AI_DISABLED_FOR_ORGANIZATION
        ? "Turn on the daily digest in Settings → AI insights first."
        : run.error.code === API_ERROR_CODE.AI_NOT_CONFIGURED
          ? "AI insights are not set up on this server yet."
          : run.error.message
    : pending
      ? "Generating… this takes about a minute."
      : timedOut
        ? // Not worded as a failure — the POST succeeded and the run may
          // still be going server-side; only the two-minute wait ended.
          "This is taking longer than expected. It may still arrive — tonight's automatic run is unaffected either way."
        : null;

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        disabled={run.isPending || Boolean(pending)}
        onClick={() => {
          setTimedOut(false);
          // Captured here, before the mutation's own `onSuccess` invalidates
          // `digestKeys.all` and a refetch can land: this is the digest the
          // reader was looking at when they asked for a new one.
          const before = latest.data ?? null;
          run.mutate(undefined, {
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
        {pending
          ? "Generating…"
          : sinceLocalDate
            ? "Generate again"
            : "Generate now"}
      </Button>
      {message ? (
        <output className="text-muted-foreground text-xs">{message}</output>
      ) : null}
    </div>
  );
}
