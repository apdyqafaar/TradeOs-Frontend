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
 * Posts `/digests/run`, then polls `latest` every 5s for up to two minutes —
 * the run itself takes about a minute (Backend spec §11). The three-a-day
 * limit is the server's; a 429 is shown where the click happened, never
 * swallowed into a toast.
 */
export function RunDigestButton({
  sinceLocalDate,
}: {
  sinceLocalDate: string | null;
}) {
  const run = useRunDigest();
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const latest = useLatestDigest({ pollMs: waitingFor ? POLL_MS : undefined });

  // Success only: this genuinely is caused by new data arriving, so a
  // dependency-driven effect is the right tool for it.
  useEffect(() => {
    if (!waitingFor) return;
    if (
      latest.data &&
      latest.data.localDate === waitingFor &&
      latest.data.generatedAt > new Date(startedAt).toISOString()
    ) {
      setWaitingFor(null);
    }
  }, [waitingFor, latest.data, startedAt]);

  // The give-up deadline, on the other hand, is NOT caused by anything
  // changing — its whole job is to fire when nothing has. A run that never
  // actually produces a digest (a backend timeout or crash after the 202)
  // leaves `latest.data` at the same `undefined` reference forever, so a
  // check living inside the effect above would never be re-evaluated after
  // the (near-zero-elapsed) run right after the click. A real timer fires on
  // its own clock regardless of whether anything else re-renders, and the
  // cleanup guarantees it cannot fire after success already cleared
  // `waitingFor`, or after the component unmounts.
  useEffect(() => {
    if (!waitingFor) return;
    const timer = setTimeout(() => {
      setWaitingFor(null);
      setTimedOut(true);
    }, GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [waitingFor]);

  const message = run.error
    ? run.error.code === API_ERROR_CODE.TOO_MANY_REQUESTS
      ? "You've used today's three manual runs. The evening digest still arrives on schedule."
      : run.error.code === API_ERROR_CODE.AI_DISABLED_FOR_ORGANIZATION
        ? "Turn on the daily digest in Settings → AI insights first."
        : run.error.code === API_ERROR_CODE.AI_NOT_CONFIGURED
          ? "AI insights are not set up on this server yet."
          : run.error.message
    : waitingFor
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
        disabled={run.isPending || Boolean(waitingFor)}
        onClick={() => {
          setTimedOut(false);
          run.mutate(undefined, {
            onSuccess: ({ localDate }) => {
              setStartedAt(Date.now());
              setWaitingFor(localDate);
            },
          });
        }}
      >
        {waitingFor
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
