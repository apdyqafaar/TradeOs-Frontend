import { Link2 } from "lucide-react";
import Link from "next/link";
import { ROUTES } from "@/config/routes";
import { formatDate } from "@/lib/format/date";
import type { Project } from "../types";
import { ProgressMeter } from "./progress-meter";
import { ProjectStatusBadge } from "./project-status-badge";

export interface ProjectCardProps {
  project: Project;
  /** The business's IANA zone. Dates on this screen are the shop's days. */
  timezone: string;
}

/**
 * One card in the projects grid — artboard `2l`, top-left panel.
 *
 * A Server Component by omission: no state, no handlers, one `<Link>`. The
 * whole card is the link rather than the title alone, because a card with a
 * cover, a title, a bar and a date has no obvious single hit target.
 *
 * **Three things the canvas asks for that the API cannot give**, all visible on
 * this card:
 *
 *   1. **The customer's name.** The canvas prints "Mwangi Stores" here.
 *      `Project.customerId` is a bare id — the Customer collection is never
 *      touched on this path (contract §1.5) — and naming twelve customers on a
 *      grid means twelve extra requests. So the card follows the precedent set
 *      by the "Who" column in
 *      `features/products/components/stock-movements-table.tsx`: an em dash
 *      with the id in the `title`, which is traceable without being invented.
 *      The detail screen, where there is exactly one customer to resolve, does
 *      fetch the name.
 *   2. **A cover thumbnail on every card.** Real, but often absent — `cover` is
 *      `null` until somebody attaches an upload — so the striped placeholder
 *      the canvas draws is the normal state, not the loading state.
 *   3. **"Published" as a live fact.** `isPublished` is honest about whether the
 *      public page serves this project. It says nothing about whether anyone can
 *      still *show* the link: the token is not on this shape, or on any read
 *      (contract §3.6). The pill therefore says "Published", not "Shared with
 *      the client".
 */
export function ProjectCard({ project, timezone }: ProjectCardProps) {
  return (
    <Link
      href={ROUTES.project(project.id)}
      className="flex flex-col overflow-hidden rounded-[10px] border border-border bg-card transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
    >
      <div className="relative flex h-[120px] items-center justify-center border-border border-b bg-surface-2">
        {project.cover ? (
          /*
            A plain `<img>`, not `next/image`, for the reason spelled out in
            `features/uploads/components/image-picker.tsx`: the S3 host comes
            from the API's environment and is unknown at build time — which is
            every development machine — and `next/image` throws on an
            unconfigured host.

            `alt=""` and `aria-hidden` because the cover is decorative: the
            title below is the real label, and the API stores no alt text
            (`project.model.ts` has no such field), so there is nothing truer
            to put here.
          */
          // biome-ignore lint/performance/noImgElement: see the note above
          <img
            src={project.cover.thumbUrl}
            alt=""
            aria-hidden="true"
            className="size-full object-cover"
          />
        ) : (
          <span className="font-mono text-[10px] text-muted-2">No cover</span>
        )}

        {project.isPublished ? (
          <span className="absolute top-2.5 right-2.5 inline-flex h-6 items-center gap-1.5 rounded-lg border border-border bg-card px-2 font-medium text-[11px] text-success-soft-foreground">
            <Link2 className="size-3.5" aria-hidden="true" />
            Published
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2.5">
          <span className="font-medium text-[15px] text-foreground text-pretty">
            {project.title}
          </span>
          <ProjectStatusBadge status={project.status} />
        </div>

        {/*
          See note 1 above. The line is rendered only when there IS a customer,
          so a project with none reads as an internal job rather than as a
          failed lookup.
        */}
        {project.customerId ? (
          <span
            className="text-[13px] text-muted-foreground"
            title={`Customer ${project.customerId}`}
          >
            Customer —
          </span>
        ) : null}

        <div className="flex items-center gap-2.5">
          <ProgressMeter
            value={project.progress}
            label={`${project.title} progress`}
          />
          <span className="font-mono text-[11px] text-foreground">
            {project.progress}%
          </span>
        </div>

        <span className="font-mono text-[11px] text-muted-2">
          {project.dueDate
            ? `Due ${formatDate(project.dueDate, timezone)}`
            : "No due date"}
        </span>
      </div>
    </Link>
  );
}
