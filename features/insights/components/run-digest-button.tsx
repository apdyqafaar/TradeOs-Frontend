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
  const latest = useLatestDigest({ pollMs: waitingFor ? POLL_MS : undefined });

  useEffect(() => {
    if (!waitingFor) return;
    if (
      latest.data &&
      latest.data.localDate === waitingFor &&
      latest.data.generatedAt > new Date(startedAt).toISOString()
    ) {
      setWaitingFor(null);
    } else if (Date.now() - startedAt > GIVE_UP_MS) {
      setWaitingFor(null);
    }
  }, [waitingFor, latest.data, startedAt]);

  const message = run.error
    ? run.error.status === 429
      ? "You've used today's three manual runs. The evening digest still arrives on schedule."
      : run.error.code === API_ERROR_CODE.AI_DISABLED_FOR_ORGANIZATION
        ? "Turn on the daily digest in Settings → AI insights first."
        : run.error.code === API_ERROR_CODE.AI_NOT_CONFIGURED
          ? "AI insights are not set up on this server yet."
          : run.error.message
    : waitingFor
      ? "Generating… this takes about a minute."
      : null;

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        disabled={run.isPending || Boolean(waitingFor)}
        onClick={() =>
          run.mutate(undefined, {
            onSuccess: ({ localDate }) => {
              setStartedAt(Date.now());
              setWaitingFor(localDate);
            },
          })
        }
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
