"use client";

import { cn } from "cn";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { CommitBar } from "@/features/product-import/components/commit-bar";
import { ReviewStep } from "@/features/product-import/components/review-step";
import type { ObjectId } from "@/lib/api/types";
import { useImportJob } from "../hooks/use-import-job";
import type { ImportJobDetail } from "../types";
import { ColumnMapStep } from "./column-map-step";
import { PreviousJobs } from "./previous-jobs";
import { UploadStep } from "./upload-step";

const STEPS = ["Upload", "Map columns", "Review rows", "Commit"] as const;

/**
 * Which of the four the stepper is pointing at, 1-based.
 *
 * Derived from the job rather than stored, except for the one decision the
 * job cannot answer — whether the person is still looking at the columns or
 * has moved on to the rows — which is `stage` below.
 */
type StepNumber = 1 | 2 | 3 | 4;

/**
 * The product import wizard — artboard `2e`
 * (`docs/design/TradeOs-UI.dc.html:708-815`).
 *
 * ### The job id lives in the URL
 *
 * `?job=<id>`, through nuqs, for the same reason every list filter in this app
 * does: a reload in the middle of a 400-row review must not throw the review
 * away, and the back button should walk out of a job rather than out of the
 * page. It also makes "resume this import" from the Previous jobs panel a
 * navigation rather than a hidden state change.
 *
 * ### Why there is no polling
 *
 * Parsing happens synchronously inside the upload request, so a job either
 * exists as `reviewing` or the `POST` itself failed. There is no `parsing`
 * status and no `failed` status to wait for (contract §5).
 *
 * ### Steps 3 and 4 belong to `ReviewStep` and `CommitBar`
 *
 * Both are self-contained and own their own queries and mutations; this file
 * decides only that a job is being reviewed and hands them the job it already
 * holds. `CommitBar` is rendered alongside the review table rather than as a
 * screen of its own, exactly as the artboard draws it — the commit is one
 * button under the rows it is about, not a page you navigate to.
 */
export function ImportWizard() {
  // `history: "push"` so opening and leaving a job are both undoable; the
  // default `replace` would make the back button skip straight off the page.
  const [jobId, setJobId] = useQueryState(
    "job",
    parseAsString.withDefault("").withOptions({ history: "push" }),
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-[32px] leading-[1.1] text-foreground">
            Import products
          </h1>
          <p className="text-[13px] text-muted-foreground">
            Bring a spreadsheet in, check what it says, then add it to your
            products.
          </p>
        </div>

        <Button
          variant="outline"
          className="h-10 rounded-[10px] px-4 text-[13px]"
          render={<Link href={ROUTES.products} />}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to products
        </Button>
      </header>

      {jobId ? (
        // Keyed by the job so every scrap of local state — which stage is
        // showing, a half-open dialog, a refusal pinned to a control — is
        // dropped when a different import is opened, rather than being
        // carried across to a job it does not describe.
        <JobWorkspace
          key={jobId}
          jobId={jobId}
          onLeave={() => void setJobId(null)}
        />
      ) : (
        <WizardFrame step={1}>
          <div className="grid gap-5 lg:grid-cols-2">
            <UploadStep onUploaded={(id) => void setJobId(id)} />
            <PreviousJobs onOpen={(id) => void setJobId(id)} />
          </div>
        </WizardFrame>
      )}
    </div>
  );
}

interface WizardFrameProps {
  step: StepNumber;
  children: React.ReactNode;
}

/**
 * The bordered card and the four-step rail every step sits inside
 * (`docs/design/TradeOs-UI.dc.html:713-722`).
 *
 * An `<ol>` because the steps are ordered and a screen reader should say so,
 * and `aria-current="step"` on the live one — the visual state alone (a filled
 * circle) says nothing to anyone not looking at it.
 */
function WizardFrame({ step, children }: WizardFrameProps) {
  return (
    <div className="flex flex-col gap-6 rounded-xl border border-border bg-background p-5 lg:p-8">
      <ol className="flex flex-wrap items-center gap-y-3">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const done = number < step;
          const current = number === step;

          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className="flex flex-1 items-center gap-2.5"
            >
              <span
                className={cn(
                  "flex size-7 flex-none items-center justify-center rounded-full border font-mono font-medium text-[12px]",
                  done &&
                    "border-primary/30 bg-primary-soft text-primary-soft-foreground",
                  current &&
                    "border-primary bg-primary text-primary-foreground",
                  !done &&
                    !current &&
                    "border-border bg-surface-2 text-muted-foreground",
                )}
              >
                {done ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  number
                )}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap font-medium text-[13px]",
                  current || done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              <span
                className="h-px min-w-4 flex-1 bg-border"
                aria-hidden="true"
              />
            </li>
          );
        })}
      </ol>

      {children}
    </div>
  );
}

interface JobWorkspaceProps {
  jobId: ObjectId;
  /** Drop `?job=` and go back to the drop zone. */
  onLeave: () => void;
}

/**
 * Everything that happens once a file has been read: the mapping, the rows,
 * and the commit — or, for a job that is no longer `reviewing`, what became of
 * it.
 *
 * The job is fetched **here and once**, with the default row page, and passed
 * down. `ReviewStep` and `CommitBar` own their own queries besides; sharing
 * this one costs nothing because React Query dedupes on the key, and it means
 * the stepper and the step it is describing cannot disagree about which job
 * they are looking at.
 */
function JobWorkspace({ jobId, onLeave }: JobWorkspaceProps) {
  /**
   * Columns first, rows second.
   *
   * Not a taste call: `PATCH /columns` re-derives every non-skipped row from
   * `raw` and destroys every manual fix (`product-import.service.ts:355-363`).
   * Settling the mapping before anyone edits a row is the only order in which
   * that destruction costs nothing, so the wizard opens on step 2 rather than
   * dropping straight into the table.
   */
  const [stage, setStage] = useState<"map" | "review">("map");
  const job = useImportJob(jobId);

  if (job.isPending) {
    return (
      <WizardFrame step={2}>
        <div className="flex flex-col gap-3" aria-busy="true">
          <span className="h-4 w-40 animate-pulse rounded bg-muted" />
          <span className="h-48 w-full animate-pulse rounded-[10px] bg-muted" />
        </div>
      </WizardFrame>
    );
  }

  if (job.error) {
    const gone = job.error.status === 404;

    return (
      <WizardFrame step={2}>
        <ErrorCard
          title={
            gone
              ? "That import is not there any more"
              : "Could not open that import"
          }
          error={{
            ...job.error,
            // A 404 covers three different histories and the API cannot tell
            // them apart: no such job, another business's job, or one that
            // aged out. The seven-day TTL makes the third the likeliest, and
            // the message the API sends ("Import job not found") does not
            // suggest it at all.
            message: gone
              ? "It was either cancelled, or it passed the seven days an import is kept for. Nothing was lost from your products — upload the file again to start over."
              : job.error.message,
          }}
          retry={
            gone
              ? undefined
              : () => {
                  void job.refetch();
                }
          }
        />
        <div>
          <Button
            variant="outline"
            onClick={onLeave}
            className="h-10 rounded-[10px] px-4 text-[13px]"
          >
            Start a new import
          </Button>
        </div>
      </WizardFrame>
    );
  }

  const data = job.data;

  if (data.status !== "reviewing") {
    return (
      <WizardFrame step={4}>
        <FinishedJob job={data} onLeave={onLeave} />
      </WizardFrame>
    );
  }

  if (stage === "map") {
    return (
      <WizardFrame step={2}>
        <ColumnMapStep
          jobId={jobId}
          job={data}
          onContinue={() => setStage("review")}
        />
        <div className="flex justify-start">
          <Button
            variant="ghost"
            onClick={onLeave}
            className="h-9 rounded-[10px] px-3 text-[13px] text-muted-foreground"
          >
            Import a different file
          </Button>
        </div>
      </WizardFrame>
    );
  }

  return (
    <WizardFrame step={3}>
      <div className="flex flex-col gap-5">
        {/*
          Both of these are the other half of this slice: each is
          self-contained, owns its own queries and mutations, and takes the
          job this workspace already holds.
        */}
        <ReviewStep jobId={jobId} job={data} />
        <CommitBar jobId={jobId} job={data} />

        <div className="flex justify-start">
          <Button
            variant="ghost"
            onClick={() => setStage("map")}
            className="h-9 rounded-[10px] px-3 text-[13px] text-muted-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to columns
          </Button>
        </div>
      </div>
    </WizardFrame>
  );
}

interface FinishedJobProps {
  job: ImportJobDetail;
  onLeave: () => void;
}

/**
 * A job that is `committed` or `cancelled`.
 *
 * Every mutating endpoint requires `reviewing`, so there is nothing for the
 * mapping or the review table to do here — both would answer 409 on the first
 * control anyone touched. What is left is the receipt, and `CommitBar` already
 * owns it: it renders `result` for a committed job and a plain note for a
 * cancelled one. Duplicating that here would be two screens disagreeing about
 * the same fact, so this contributes only the way out.
 *
 * The filename is worth repeating because the receipt does not carry it, and
 * "which file was that?" is the question someone comes back to this screen
 * with a day later.
 */
function FinishedJob({ job, onLeave }: FinishedJobProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          Step 4 · Commit
        </span>
        <p className="font-serif text-2xl leading-tight text-foreground">
          {job.filename}
        </p>
      </div>

      <CommitBar jobId={job.id} job={job} />

      <div className="flex flex-wrap gap-2.5">
        <Button
          className="h-10 rounded-[10px] px-4 text-[13px]"
          render={<Link href={ROUTES.products} />}
        >
          See the products
        </Button>
        <Button
          variant="outline"
          onClick={onLeave}
          className="h-10 rounded-[10px] px-4 text-[13px]"
        >
          Import another file
        </Button>
      </div>
    </div>
  );
}
