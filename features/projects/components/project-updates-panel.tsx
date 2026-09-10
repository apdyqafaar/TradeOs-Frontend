"use client";

import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/features/auth/hooks/use-permission";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatRelative } from "@/lib/format/date";
import { useCreateProjectUpdate } from "../hooks/use-project-mutations";
import { useProjectUpdates } from "../hooks/use-project-updates";
import { createProjectUpdateSchema } from "../schemas/project.schema";
import type { Project, ProjectUpdate } from "../types";
import { DeleteUpdateDialog } from "./delete-update-dialog";

export interface ProjectUpdatesPanelProps {
  project: Project;
  timezone: string;
}

const CONTROL =
  "w-full rounded-[10px] border border-border bg-card px-3 py-2.5 text-[14px] text-foreground transition-colors placeholder:text-muted-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

/**
 * The Updates panel — artboard `2l`, the detail screen's main column.
 *
 * **Posting an update is a write on the project, not just on a list.** When the
 * composer sends `progress`, the API writes that value onto the project row in
 * the same transaction (`project.service.ts:291-294`, proven
 * `projects.test.ts:135-163`). That is not obvious from a box labelled "What
 * changed?", so the composer says it in the sentence under the slider — and it
 * only sends `progress` when the slider has actually been moved, so an untouched
 * one cannot silently rewrite the project's number.
 *
 * **Both controls here need `projects:update`**, not `projects:create` /
 * `projects:delete` — posting and deleting a note are both modelled as writes
 * on the project (`project.route.ts:92-94,100,109`). Getting that wrong would
 * hide the composer from a Manager or show it to somebody whose every post is a
 * 403. Hidden, never disabled (brief §1.1).
 *
 * **These are the same rows the client sees.** Every update is public the
 * moment the project is, with no per-update visibility flag anywhere in the
 * model (contract §4.3) — so this panel is not an internal log, and the empty
 * state says as much.
 */
export function ProjectUpdatesPanel({
  project,
  timezone,
}: ProjectUpdatesPanelProps) {
  const canWrite = useCan(PERMISSIONS.PROJECTS_UPDATE);
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<ProjectUpdate>();

  const { data, error, isPending, isPlaceholderData, refetch } =
    useProjectUpdates(project.id, { page });

  const items = data?.items ?? [];
  const meta = data?.meta;

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-card">
      <div className="border-border border-b bg-surface-2 px-[18px] py-2.5 font-mono font-medium text-[11px] text-foreground uppercase tracking-[0.08em]">
        Updates
      </div>

      {canWrite ? (
        <UpdateComposer project={project} />
      ) : (
        <p className="border-border border-b bg-surface-2/60 px-[18px] py-3 text-[12px] text-muted-foreground">
          These updates are what the client sees on the shared page.
        </p>
      )}

      {error ? (
        <div className="p-[18px]">
          <ErrorCard
            error={error}
            title="Couldn't load the updates"
            retry={() => {
              void refetch();
            }}
          />
        </div>
      ) : isPending ? (
        <div className="flex flex-col gap-3 p-[18px]">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder rows with no identity of their own, never reordered
              key={index}
              className="h-[52px] w-full rounded-[8px]"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="px-[18px] py-6 text-center text-[13px] text-muted-foreground">
          {page > 1
            ? "Nothing on this page any more."
            : "No updates yet. What you post here is what the client reads."}
        </p>
      ) : (
        <div className={cn(isPlaceholderData && "opacity-60")}>
          {items.map((update) => (
            <UpdateRow
              key={update.id}
              update={update}
              timezone={timezone}
              canDelete={canWrite}
              onDelete={() => setDeleting(update)}
            />
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 ? (
        <nav
          aria-label="Update pages"
          className="flex items-center justify-between gap-3 border-border border-t px-[18px] py-3"
        >
          <span className="font-mono text-[11px] text-muted-2">
            Page {meta.page} of {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1 || isPlaceholderData}
              onClick={() => setPage((current) => current - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Newer
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages || isPlaceholderData}
              onClick={() => setPage((current) => current + 1)}
            >
              Older
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : null}

      {deleting ? (
        <DeleteUpdateDialog
          update={deleting}
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(undefined);
          }}
          onDeleted={() => setDeleting(undefined)}
        />
      ) : null}
    </div>
  );
}

/**
 * One posted note.
 *
 * **The "who" is missing and cannot be filled in.** `createdBy` is a bare
 * **Member** id — no name, no `author` object, the exact opposite of an
 * announcement (contract §1.6, trap 4) — and resolving it means a members
 * endpoint this slice does not touch. So it follows the precedent set by the
 * "Who" column in `features/products/components/stock-movements-table.tsx`: an
 * em dash with the id in the `title`, which is traceable without being a
 * fabricated name. The canvas prints a person's name here; this is the honest
 * version of it.
 */
function UpdateRow({
  update,
  timezone,
  canDelete,
  onDelete,
}: {
  update: ProjectUpdate;
  timezone: string;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-[7px] border-border border-b px-[18px] py-3.5 last:border-b-0">
      <p className="text-[13px] text-foreground leading-[1.55] text-pretty">
        {update.body}
      </p>
      <div className="flex items-center gap-2.5">
        {/*
          `!== null`, not truthiness: `progress: 0` is a real value and a note
          that reset a project to zero is exactly the one worth showing.
        */}
        {update.progress !== null ? (
          <span className="inline-flex h-[22px] items-center rounded-lg bg-primary-soft px-2 font-medium font-mono text-[11px] text-primary-soft-foreground">
            {update.progress}%
          </span>
        ) : null}
        <span
          className="text-[12px] text-muted-foreground"
          title={`Posted by member ${update.createdBy}`}
        >
          —
        </span>
        <span className="font-mono text-[11px] text-muted-2">
          {formatRelative(update.createdAt, timezone)}
        </span>
        <span className="flex-1" />
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="text-[12px] text-muted-2 transition-colors hover:text-destructive-strong focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The composer — a body, a progress slider, and the sentence that makes the
 * slider honest.
 *
 * `progress` is sent **only when the slider has been moved**. The API takes it
 * as optional with no default, and omitting it leaves the project's own
 * progress untouched (the note comes back with `progress: null`). Sending the
 * project's current value on every post would be harmless in the row but would
 * write the same number back onto the project each time and put a meaningless
 * percentage badge on every note.
 */
function UpdateComposer({ project }: { project: Project }) {
  const create = useCreateProjectUpdate();

  const [body, setBody] = useState("");
  const [progress, setProgress] = useState(project.progress);
  const [moved, setMoved] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);

  const submit = () => {
    const parsed = createProjectUpdateSchema.safeParse({
      body,
      // Omitted, not `null`: `progress: null` is a 422 (contract §1.4).
      ...(moved ? { progress } : {}),
    });
    if (!parsed.success) {
      setIssue(parsed.error.issues[0]?.message ?? "That update cannot be sent");
      return;
    }

    setIssue(null);
    create.mutate(
      { projectId: project.id, input: parsed.data },
      {
        onSuccess: () => {
          setBody("");
          setMoved(false);
        },
        onError: (error: ApiError) => {
          if (error.code === API_ERROR_CODE.NOT_FOUND) {
            setIssue(
              "This project no longer exists — someone deleted it while this page was open.",
            );
            return;
          }
          const fields = fieldErrorsFor(error);
          setIssue(fields.body ?? fields.progress ?? error.message);
        },
      },
    );
  };

  const busy = create.isPending;

  return (
    <div className="flex flex-col gap-2.5 border-border border-b bg-surface-2/60 px-[18px] py-4">
      <label className="sr-only" htmlFor="project-update-body">
        What changed since the last update?
      </label>
      <textarea
        id="project-update-body"
        rows={3}
        value={body}
        disabled={busy}
        maxLength={5000}
        placeholder="What changed since the last update?"
        onChange={(event) => {
          setBody(event.target.value);
          setIssue(null);
        }}
        aria-invalid={issue ? true : undefined}
        className={cn(CONTROL, "min-h-[72px] resize-y")}
      />

      <div className="flex flex-wrap items-center gap-3.5">
        <label
          className="flex-none text-[12px] text-muted-foreground"
          htmlFor="project-update-progress"
        >
          Progress
        </label>
        {/*
          A native range input styled with `accent-primary`, rather than the
          bar-and-fill span the canvas draws: the canvas's is a read-only
          picture, and this one has to be draggable and reachable by keyboard.
          The meter below the composer is where the picture lives.
        */}
        <input
          id="project-update-progress"
          type="range"
          min={0}
          max={100}
          step={1}
          value={progress}
          disabled={busy}
          onChange={(event) => {
            setProgress(Number(event.target.value));
            setMoved(true);
            setIssue(null);
          }}
          className="h-1.5 flex-1 accent-primary"
        />
        <span className="flex-none font-mono text-[12px] text-foreground">
          {progress}%
        </span>
        <Button
          type="button"
          disabled={busy}
          onClick={submit}
          className="h-[34px] flex-none rounded-[9px] px-3.5 text-[13px]"
        >
          {busy ? "Posting…" : "Post"}
        </Button>
      </div>

      {/*
        The whole reason this composer is careful. An untouched slider changes
        nothing; a moved one rewrites the project — and deleting the note
        afterwards will not put the old number back (contract §4.4).
      */}
      <p className="text-[12px] text-muted-foreground">
        {moved
          ? `Posting this also sets the project to ${progress}%. Deleting the update later will not change it back.`
          : "Move the slider to change the project's progress as well."}
      </p>

      {issue ? (
        <p role="alert" className="text-[12px] text-destructive-strong">
          {issue}
        </p>
      ) : null}
    </div>
  );
}
