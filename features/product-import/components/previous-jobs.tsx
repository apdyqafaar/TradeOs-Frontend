"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { X } from "lucide-react";
import { useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { formatDate } from "@/lib/format/date";
import { useImportJobs } from "../hooks/use-import-jobs";
import { useCancelImport } from "../hooks/use-import-mutations";
import {
  IMPORT_EXPIRY_DAYS,
  type ImportJobStatus,
  type ImportJobSummary,
} from "../types";

/**
 * Five rows. The panel sits beside the drop zone rather than being a screen of
 * its own, and there is deliberately no paging: this list exists to resume
 * something started an hour ago, and **nothing here survives a week** — the
 * TTL is seven days from upload, for committed jobs too — so a deep history
 * would be a history of empty.
 *
 * Frozen at module scope so it is one cache entry rather than a new object
 * identity, and so a new query key, on every render.
 */
const RECENT = Object.freeze({ limit: 5 });

const STATUS_LABELS: Record<ImportJobStatus, string> = {
  reviewing: "Reviewing",
  committed: "Committed",
  cancelled: "Cancelled",
};

/**
 * Amber, green, muted — artboard `2e` draws the first two
 * (`docs/design/TradeOs-UI.dc.html:736,742`) and the palette is the one every
 * other status pill in this app already uses.
 *
 * `cancelled` is the quietest tone there is on purpose: nothing was written
 * and nothing is wrong, so it must not read as a failure.
 */
const STATUS_STYLES: Record<ImportJobStatus, string> = {
  reviewing: "bg-warning-soft text-warning-strong",
  committed: "bg-success-soft text-success-strong",
  cancelled: "bg-muted text-muted-2",
};

const PILL =
  "inline-flex h-[22px] flex-none items-center rounded-lg px-2 font-medium text-[11px]";

/**
 * `expiresAt` as a duration, not a date.
 *
 * Days are rounded **up**: a job with 5 d 23 h left expires during its sixth
 * day from now, and "expires in 5 d" would be an hour-accurate lie about which
 * day it dies. Below a day the unit changes, because "expires in 1 d" over
 * thirty remaining minutes is the one rounding error that actually costs
 * someone their work.
 *
 * No timezone is involved and none should be: this is an elapsed duration
 * between two instants, and a calendar-day difference would move it across
 * midnight for a reader in another zone.
 */
export const expiryLabel = (expiresAt: string, now: Date): string => {
  const remaining = new Date(expiresAt).getTime() - now.getTime();
  if (Number.isNaN(remaining)) return "";
  // Mongo's TTL monitor runs about once a minute, so a job can still be read
  // for a little while past this instant. The label says the truth anyway.
  if (remaining <= 0) return "expired";

  const hours = remaining / 3_600_000;
  if (hours < 1) return "expires within the hour";
  if (hours < 24) return `expires in ${Math.floor(hours)} h`;
  return `expires in ${Math.ceil(hours / 24)} d`;
};

export interface PreviousJobsProps {
  /** Resume a `reviewing` job. The wizard puts the id in the URL. */
  onOpen: (jobId: ObjectId) => void;
  /** Injected so the expiry label is testable without freezing the clock. */
  now?: Date;
}

/**
 * The "Previous jobs" panel of artboard `2e`
 * (`docs/design/TradeOs-UI.dc.html:734-745`).
 *
 * ### What this list can and cannot say
 *
 * `GET /products/import` strips `rows` at the database layer, so a row carries
 * `status`, `counts`, `filename`, `totalRows` and `expiresAt` and nothing
 * more. That is enough to resume a job and not nearly enough to commit one —
 * committing needs per-row `conflict.resolution`, which only `GET /:id`
 * carries. So there is no Commit button here, by construction rather than by
 * taste.
 *
 * It also cannot show who uploaded the file. `createdBy` is stored on the
 * model and the public shaper never maps it, so there is no member id to join
 * against (contract §5).
 *
 * And there is no server-side filter: `?status=` on this endpoint is a **422**,
 * not an ignored key, so a "cancelled only" tab is not something this panel can
 * honestly offer.
 */
export function PreviousJobs({ onOpen, now = new Date() }: PreviousJobsProps) {
  const jobs = useImportJobs(RECENT);
  const { timezone, isLoading: organizationLoading } = useOrganization();
  const [cancelling, setCancelling] = useState<ImportJobSummary | null>(null);

  const items = jobs.data?.items ?? [];
  // Dates must not land before the timezone they are read in: a row that says
  // "02 Sep" and corrects itself to "03 Sep" a beat later reads as a bug.
  const loading = jobs.isPending || organizationLoading;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-[10px] border border-border bg-card">
        <h2 className="border-border border-b bg-muted px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          Previous jobs
        </h2>

        {loading ? (
          <ul>
            {[0, 1].map((row) => (
              <li
                key={row}
                className="flex h-11 items-center gap-3 border-border/60 border-b px-4 last:border-b-0"
              >
                <span className="h-3 w-10 animate-pulse rounded bg-muted" />
                <span className="h-3 w-20 flex-1 animate-pulse rounded bg-muted" />
                <span className="h-[22px] w-20 animate-pulse rounded-lg bg-muted" />
              </li>
            ))}
          </ul>
        ) : jobs.error ? (
          <div className="p-3">
            <ErrorCard
              title="Could not list previous imports"
              error={jobs.error}
              // A 403 is not a failure to retry — nothing broke, this member
              // simply may not read them — so no button that would ask again.
              retry={
                jobs.error.status === 403
                  ? undefined
                  : () => {
                      void jobs.refetch();
                    }
              }
            />
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
            Nothing imported yet. A file you upload shows up here while you work
            through it.
          </p>
        ) : (
          <ul>
            {items.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                timezone={timezone}
                now={now}
                onOpen={onOpen}
                onCancel={() => setCancelling(job)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Not a footnote for its own sake: the expiry is absolute and applies to
          committed jobs too, so the receipt of a finished import disappears on
          the same schedule as an abandoned one (contract Trap 12). Someone who
          reads "Committed" as "kept" will look for it in a fortnight. */}
      <p className="text-[12px] text-muted-foreground">
        An import and everything it recorded are deleted {IMPORT_EXPIRY_DAYS}{" "}
        days after the file was uploaded. Committing does not extend that; the
        products it created stay, the record of the import does not.
      </p>

      <CancelDialog
        job={cancelling}
        onClose={() => setCancelling(null)}
        timezone={timezone}
      />
    </div>
  );
}

interface JobRowProps {
  job: ImportJobSummary;
  timezone: string;
  now: Date;
  onOpen: (jobId: ObjectId) => void;
  onCancel: () => void;
}

/**
 * One row: format, row count, status, and either an expiry or a date
 * (`docs/design/TradeOs-UI.dc.html:736-744`).
 *
 * The cells are a `<button>` only while the job is `reviewing`, because that
 * is the only status this wizard can do anything with — the mutating endpoints
 * all require it, and opening a committed job to look at a form that would 409
 * on every control is worse than a row that does not move. A finished job
 * still shows what it did, in words rather than as a destination.
 */
function JobRow({ job, timezone, now, onOpen, onCancel }: JobRowProps) {
  const reviewing = job.status === "reviewing";

  const cells = (
    <>
      <span className="w-13 flex-none font-mono text-[12px] text-foreground">
        {job.format.toUpperCase()}
      </span>
      <span className="flex-1 truncate font-mono text-[12px] text-muted-foreground">
        {job.totalRows.toLocaleString()} rows
      </span>
      <span className={cn(PILL, STATUS_STYLES[job.status])}>
        {STATUS_LABELS[job.status]}
      </span>
      <span className="flex-none font-mono text-[11px] text-muted-2">
        {reviewing
          ? expiryLabel(job.expiresAt, now)
          : formatDate(job.committedAt ?? job.updatedAt, timezone)}
      </span>
    </>
  );

  return (
    <li className="flex h-11 items-center gap-3 border-border/60 border-b px-4 last:border-b-0">
      {reviewing ? (
        <button
          type="button"
          onClick={() => onOpen(job.id)}
          // The filename is the thing a person recognises, and it is the one
          // field this row has no width for, so it carries the accessible name
          // and the tooltip instead of a truncated column.
          title={job.filename}
          className="-mx-1 flex h-full flex-1 items-center gap-3 rounded px-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="sr-only">Resume the import of {job.filename}</span>
          {cells}
        </button>
      ) : (
        <div
          className="flex h-full flex-1 items-center gap-3"
          title={job.filename}
        >
          {cells}
        </div>
      )}

      {reviewing ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onCancel}
          aria-label={`Cancel the import of ${job.filename}`}
          className="flex-none text-muted-2 hover:text-destructive"
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
}

interface CancelDialogProps {
  job: ImportJobSummary | null;
  onClose: () => void;
  timezone: string;
}

/**
 * Cancelling is destructive in the way that matters — everything staged in the
 * job stops being importable — so it asks first, and it says what it is
 * throwing away.
 *
 * **It is a soft cancel, not a delete.** The job survives as
 * `status: "cancelled"` and keeps its place in this list until its TTL fires;
 * there is no delete endpoint anywhere in this API. A dialog that promised to
 * remove the row would be describing something that does not happen, so the
 * copy says "stops" rather than "deletes" and the row stays put afterwards.
 *
 * The one refusal worth its own words is 409 `IMPORT_NOT_REVIEWING`, which
 * here almost always means a second tab got there first.
 */
function CancelDialog({ job, onClose, timezone }: CancelDialogProps) {
  const cancel = useCancelImport();
  const [issue, setIssue] = useState<string | null>(null);

  const close = () => {
    setIssue(null);
    cancel.reset();
    onClose();
  };

  const confirm = () => {
    if (!job) return;
    setIssue(null);
    cancel.mutate(job.id, {
      onSuccess: close,
      onError: (error: ApiError) => {
        setIssue(
          error.code === API_ERROR_CODE.IMPORT_NOT_REVIEWING
            ? "This import has already been committed or cancelled — most likely in another tab. The list below is up to date now."
            : error.message,
        );
      },
    });
  };

  return (
    <Dialog.Root
      open={job !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[460px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-serif text-2xl leading-tight text-foreground">
            Stop this import?
          </Dialog.Title>

          <Dialog.Description className="text-[13px] text-muted-foreground">
            {job ? (
              <>
                Nothing from{" "}
                <span className="font-medium text-foreground">
                  {job.filename}
                </span>{" "}
                has been added to your products, and nothing will be. The{" "}
                {job.totalRows.toLocaleString()} staged rows and every fix made
                to them stop being importable. The job itself stays in this list
                as cancelled until it is cleared on{" "}
                {formatDate(job.expiresAt, timezone)}.
              </>
            ) : null}
          </Dialog.Description>

          {issue ? (
            <p
              role="alert"
              className="rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong"
            >
              {issue}
            </p>
          ) : null}

          <div className="flex justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={cancel.isPending}
              onClick={close}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancel.isPending}
              onClick={confirm}
              className="h-10 rounded-[10px] px-4 font-semibold text-[13px]"
            >
              {cancel.isPending ? "Stopping…" : "Stop the import"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
