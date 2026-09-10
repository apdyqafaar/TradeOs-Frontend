"use client";

import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useCustomer } from "@/features/customers/hooks/use-customer";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import type { ObjectId } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format/date";
import { useProject } from "../hooks/use-project";
import type { Project } from "../types";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { ProgressMeter } from "./progress-meter";
import { ProjectFormSheet } from "./project-form-sheet";
import { ProjectStatusBadge } from "./project-status-badge";
import { ProjectUpdatesPanel } from "./project-updates-panel";
import { ShareCard } from "./share-card";

export interface ProjectDetailProps {
  projectId: ObjectId;
}

/**
 * One project — artboard `2l`, the middle panel.
 *
 * The layout is the canvas's: a cover banner, a header carrying the title,
 * status, dates, customer and a large progress figure, then a 1.6fr / 1fr grid
 * of description-plus-updates against the share card.
 *
 * **Two permissions decide what is on the page, and they are not the same
 * one.** `projects:update` owns Edit *and* the update composer *and* the delete
 * control on a note (`project.route.ts:92-94,100,109` — posting and deleting a
 * note are writes on the project). `projects:publish` owns the entire share
 * card, all three of its actions at once. Each is hidden rather than disabled
 * (brief §1.1).
 *
 * **The customer's name costs a second request** and is the one place in this
 * slice where it is worth paying: there is exactly one customer here, versus a
 * gridful, and the canvas's chip is meaningless without it. It is gated on
 * `customers:view` and degrades to the em-dash treatment when the lookup fails
 * — the project is not less readable for want of a customer name.
 */
export function ProjectDetail({ projectId }: ProjectDetailProps) {
  const router = useRouter();
  const { timezone, isLoading: organizationLoading } = useOrganization();
  const { data: project, error, isPending, refetch } = useProject(projectId);

  const canUpdate = useCan(PERMISSIONS.PROJECTS_UPDATE);
  const canDelete = useCan(PERMISSIONS.PROJECTS_DELETE);
  const canPublish = useCan(PERMISSIONS.PROJECTS_PUBLISH);

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // A 403 is not a failure to retry: nothing broke, the caller simply may not
  // read this. The page is already gated server-side on `projects:view`, so
  // arriving here means the session's permissions changed mid-visit.
  if (error?.status === 403) return <ForbiddenScreen />;

  if (error?.status === 404) {
    return (
      <EmptyState
        title="This project is gone"
        description="It was deleted, or the link points at something in another business."
        action={
          <Button
            variant="outline"
            size="sm"
            render={<Link href={ROUTES.projects} />}
          >
            Back to projects
          </Button>
        }
      />
    );
  }

  if (error) {
    return (
      <ErrorCard
        error={error}
        title="Couldn't load this project"
        retry={() => {
          void refetch();
        }}
      />
    );
  }

  if (isPending || organizationLoading || !project) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-[150px] w-full rounded-[12px]" />
        <Skeleton className="h-10 w-2/3 rounded-[10px]" />
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <Skeleton className="h-[420px] w-full rounded-[10px]" />
          <Skeleton className="h-[260px] w-full rounded-[10px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={ROUTES.projects}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Projects
      </Link>

      <div className="overflow-hidden rounded-[12px] border border-border bg-background">
        {project.cover ? (
          /*
            A plain `<img>`, not `next/image`, for the reason spelled out in
            `features/uploads/components/image-picker.tsx`: the S3 host comes
            from the API's environment and is unknown at build time — which is
            every development machine — and `next/image` throws on an
            unconfigured host.
          */
          // biome-ignore lint/performance/noImgElement: see the note above
          <img
            src={project.cover.url}
            alt=""
            aria-hidden="true"
            className="h-[150px] w-full border-border border-b object-cover"
          />
        ) : null}

        <div className="flex flex-col gap-5 p-7">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="font-serif text-[30px] text-foreground leading-[1.1]">
                {project.title}
              </h1>
              <div className="flex flex-wrap items-center gap-2.5">
                <ProjectStatusBadge
                  status={project.status}
                  className="h-8 rounded-[9px] px-3 text-[13px]"
                />
                <DateRange project={project} timezone={timezone} />
                <CustomerChip customerId={project.customerId} />
              </div>
            </div>

            <div className="flex flex-col items-center gap-1">
              <span className="font-medium font-mono text-[26px] text-foreground">
                {project.progress}%
              </span>
              <ProgressMeter
                value={project.progress}
                height={8}
                label="Project progress"
                className="w-[120px] flex-none"
              />
            </div>
          </div>

          {(canUpdate || canDelete) && (
            <div className="flex flex-wrap gap-2.5">
              {canUpdate ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleting(true)}
                  className="text-destructive-strong"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete
                </Button>
              ) : null}
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <div className="flex flex-col gap-4">
              <div className="rounded-[10px] border border-border bg-card p-[18px]">
                <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
                  Description
                </span>
                {/*
                  `?.trim()` and not `== null`: a description cleared through
                  this API is `""` on the wire, not `null`, because
                  `description: null` is a 422 and `toProjectResponse` only
                  maps `null`/`undefined` (contract §1.3). Testing for null
                  alone renders an empty box where the placeholder belongs.

                  `whitespace-pre-line` because the field is plain text with no
                  markdown — paragraph breaks are the only structure it has, and
                  dropping them turns a three-paragraph brief into a wall.
                */}
                <p className="mt-2 whitespace-pre-line text-[13px] text-foreground leading-[1.6] text-pretty">
                  {project.description?.trim() ? (
                    project.description
                  ) : (
                    <span className="text-muted-foreground">
                      No description yet. The client sees this on the shared
                      page.
                    </span>
                  )}
                </p>
              </div>

              <ProjectUpdatesPanel project={project} timezone={timezone} />
            </div>

            <div className="flex flex-col gap-4">
              {/*
                One permission covers publish, unpublish and regenerate
                (`project.route.ts:118,127,136`), so the card is all-or-nothing.
                Hidden rather than disabled: a member who cannot share a project
                does not need to learn that sharing exists.
              */}
              {canPublish ? (
                <ShareCard project={project} timezone={timezone} />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {canUpdate ? (
        <ProjectFormSheet
          open={editing}
          onOpenChange={setEditing}
          project={project}
        />
      ) : null}

      {canDelete ? (
        <DeleteProjectDialog
          project={project}
          open={deleting}
          onOpenChange={setDeleting}
          onDeleted={() => router.push(ROUTES.projects)}
        />
      ) : null}
    </div>
  );
}

/** `18 Aug 2026 → 18 Sep 2026`, or whichever half exists. */
function DateRange({
  project,
  timezone,
}: {
  project: Project;
  timezone: string;
}) {
  if (!project.startDate && !project.dueDate) return null;

  const start = project.startDate
    ? formatDate(project.startDate, timezone)
    : null;
  const due = project.dueDate ? formatDate(project.dueDate, timezone) : null;

  return (
    <span className="font-mono text-[12px] text-muted-foreground">
      {start && due
        ? `${start} → ${due}`
        : start
          ? `From ${start}`
          : `Due ${due}`}
    </span>
  );
}

/**
 * The customer chip — the canvas's "Mwangi Stores".
 *
 * `Project.customerId` is a bare id (contract §1.5), so this is a second
 * request, and it is gated twice over: on `customers:view`, and on there being
 * a customer at all. When the lookup fails — a 403 from a stale permission, an
 * archived customer, a network blip — it falls back to the em-dash treatment
 * used by `stock-movements-table.tsx`'s "Who" column rather than to a guess or
 * to a broken-looking chip.
 */
function CustomerChip({ customerId }: { customerId: ObjectId | null }) {
  const canSeeCustomers = useCan(PERMISSIONS.CUSTOMERS_VIEW);
  const enabled = Boolean(customerId) && canSeeCustomers;
  const { data, isPending } = useCustomer(
    enabled ? (customerId ?? undefined) : undefined,
  );

  if (!customerId) return null;

  return (
    <span
      className="inline-flex h-[26px] items-center rounded-lg bg-surface-2 px-2.5 text-[12px] text-foreground"
      title={`Customer ${customerId}`}
    >
      {data?.customer.name ?? (enabled && isPending ? "…" : "Customer —")}
    </span>
  );
}
