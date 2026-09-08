"use client";

import { cn } from "cn";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * What the card needs from a failure.
 *
 * Structural rather than `ApiError` so a caller can hand over anything the
 * data layer produced — including React Query's `error` before it has been
 * narrowed — without a cast. Every `ApiError` satisfies it by construction.
 */
export interface ErrorCardError {
  message: string;
  /** The `X-Request-Id` header. Support asks for it; that is the whole point of this card. */
  requestId?: string;
  status?: number;
  code?: string;
}

interface ErrorCardProps {
  error: ErrorCardError;
  /**
   * Usually `() => query.refetch()`. Omit it for a failure retrying cannot
   * fix — a 403, a 422 — so the card does not offer an action that will do
   * exactly the same thing again.
   */
  retry?: () => void;
  /** Overrides the default heading when a panel can say something more specific. */
  title?: string;
  className?: string;
}

/**
 * The inline error panel brief §8.4 requires: the human message, and the
 * request id in a tiny mono line.
 *
 * The request id is the reason this is a shared component instead of a `<p>`
 * at each call site. It is the only thing that connects what the user saw to
 * the server's log line, and it is the first thing support asks for — so it is
 * rendered wherever a request failed, not just where someone remembered.
 *
 * The message is the API's, verbatim. Never branch on it to pick different
 * copy; branch on `code` (`API_ERROR_CODE`) if a failure needs its own words.
 */
export function ErrorCard({
  error,
  retry,
  title = "Couldn't load this",
  className,
}: ErrorCardProps) {
  return (
    <div
      data-slot="error-card"
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-[10px] border border-destructive/40 bg-destructive-soft px-[18px] py-4",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert
          className="mt-px size-4 flex-none text-destructive"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-destructive-strong">{title}</p>
          <p className="text-[13px] text-foreground">{error.message}</p>
          {error.requestId ? (
            <p
              data-slot="error-card-request-id"
              className="mt-0.5 font-mono text-[11px] text-muted-foreground"
            >
              Request ID: {error.requestId}
            </p>
          ) : null}
        </div>
      </div>

      {/* ml-[26px] = the 16px icon plus the 10px gap, so the action lines up
          under the message rather than under the warning triangle. */}
      {retry ? (
        <Button
          variant="outline"
          size="sm"
          onClick={retry}
          className="ml-[26px]"
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}
