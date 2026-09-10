import { cn } from "cn";
import { formatDate } from "@/lib/format/date";
import type { PublicProject } from "../types";
import { ProgressMeter } from "./progress-meter";
import { ProjectStatusBadge } from "./project-status-badge";

export interface PublicProjectViewProps {
  data: PublicProject;
}

/**
 * The zone every date on this page is read in. See `PublicDate` at the foot of
 * the file for why it is UTC and why that is a refusal rather than a default.
 */
const PUBLIC_TIME_ZONE = "UTC";

/**
 * The client-facing project page — artboard `2l`, the right-hand panel.
 *
 * **A Server Component with no client boundary anywhere below it.** The reader
 * is a client of the business, not a user of the product: there is no session,
 * no sidebar, no query cache, nothing to hydrate. Everything on the page is one
 * server-side read, and the page is HTML.
 *
 * **It renders exactly what the payload carries and nothing else.** The
 * whitelist is `{ business: {name, logo}, project: {title, description, status,
 * progress, startDate, dueDate, updatedAt, cover}, updates: [{body, progress,
 * createdAt}] }` — asserted as an exact key set at all three levels by
 * `public-link.test.ts:98-105`. There is no id, no customer, no author, no
 * publish state and no organization detail here to draw with, so the canvas's
 * in-app chrome is deliberately absent rather than approximated: no "posted by",
 * no customer chip, no back link into an app the reader has no account for.
 *
 * **Every field is nullable and the empty case is normal.** A business may have
 * no logo, a project no description, no dates and no cover, and a published
 * project may have no updates at all — which is what a client sees on the day
 * the link is first sent. Each of those renders as absence, never as a
 * placeholder or a skeleton.
 */
export function PublicProjectView({ data }: PublicProjectViewProps) {
  const { business, project, updates } = data;

  return (
    <main className="mx-auto flex w-full max-w-[600px] flex-col gap-[22px] px-6 py-10">
      <header className="flex items-center gap-2.5">
        {business.logo ? (
          /*
            A plain `<img>`, not `next/image`: the S3 host comes from the API's
            environment and is unknown at build time, and `next/image` throws on
            an unconfigured host.

            Note this URL keeps resolving after the project is unpublished — the
            bucket is public-read with no signed URLs (`storage.ts:27-28`,
            `FINDINGS` §3). Nothing on this page can change that; it is why the
            in-app copy never promises that unpublishing revokes everything.
          */
          // biome-ignore lint/performance/noImgElement: see the note above
          <img
            src={business.logo}
            alt=""
            aria-hidden="true"
            className="size-[30px] flex-none rounded-[7px] object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-[30px] flex-none items-center justify-center rounded-[7px] bg-primary-soft font-medium font-mono text-[13px] text-primary-soft-foreground"
          >
            {/*
              The initial, and only when there is a name to take one from.
              `business.name` is `""` when the organization row is gone
              (`public-project.service.ts:46-47`) — the API still answers 200 —
              so this cannot assume a first character exists.
            */}
            {business.name.trim().charAt(0).toUpperCase() || "·"}
          </span>
        )}
        {business.name.trim() ? (
          <span className="font-medium text-[14px] text-foreground">
            {business.name}
          </span>
        ) : null}
      </header>

      <div className="flex flex-col gap-2.5">
        <h1 className="font-serif text-[34px] text-foreground leading-[1.1] text-pretty">
          {project.title}
        </h1>

        <div className="flex flex-wrap items-center gap-3">
          <ProjectStatusBadge
            status={project.status}
            withDot
            className="h-6 rounded-lg px-2.5 text-[12px]"
          />
          <PublicDateRange
            startDate={project.startDate}
            dueDate={project.dueDate}
          />
        </div>

        <div className="flex items-center gap-3">
          <ProgressMeter value={project.progress} height={8} label="Progress" />
          <span className="font-mono text-[13px] text-foreground">
            {project.progress}%
          </span>
        </div>
      </div>

      {project.cover ? (
        // biome-ignore lint/performance/noImgElement: same unconfigured-host reason as the logo above
        <img
          src={project.cover.url}
          alt=""
          aria-hidden="true"
          className="aspect-video w-full rounded-[10px] border border-border object-cover"
        />
      ) : null}

      {/*
        `whitespace-pre-line` because the description is plain text with no
        markdown — paragraph breaks are the only structure it has.

        `?.trim()` and not a null check: a description cleared in the app is
        `""` on the wire, not `null` (contract §1.3), and an empty paragraph
        would leave a gap the reader cannot explain.
      */}
      {project.description?.trim() ? (
        <p className="whitespace-pre-line text-[14px] text-foreground leading-[1.65] text-pretty">
          {project.description}
        </p>
      ) : null}

      {updates.length > 0 ? (
        <div className="flex flex-col">
          {updates.map((update) => (
            <article
              // No id on a public update (`public-project.service.ts:60-64`),
              // so the key is the one thing that is unique per row: its
              // timestamp, which is generated per insert. The list is never
              // reordered and never re-rendered against a different payload
              // without a full page load, so this is a stable identity here in
              // a way it would not be inside the app.
              key={update.createdAt}
              className="flex flex-col gap-[7px] border-border border-t py-4"
            >
              <div className="flex items-center gap-2.5">
                {/*
                  `!== null`, not truthiness: `progress: 0` is a real value, and
                  a client watching a project reset to zero should see it.
                */}
                {update.progress !== null ? (
                  <span className="inline-flex h-[22px] items-center rounded-lg bg-primary-soft px-2 font-medium font-mono text-[11px] text-primary-soft-foreground">
                    {update.progress}%
                  </span>
                ) : null}
                <PublicDate
                  value={update.createdAt}
                  className="text-[11px] text-muted-2"
                />
              </div>
              <p className="text-[14px] text-foreground leading-[1.6] text-pretty">
                {update.body}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="border-border border-t py-4 text-[13px] text-muted-foreground">
          No updates have been posted yet.
        </p>
      )}

      <footer className="border-border border-t pt-3 text-center font-mono text-[11px] text-muted-3">
        Shared via TradeOs
      </footer>
    </main>
  );
}

/**
 * A date on the public page.
 *
 * **The zone is UTC and that is a deliberate refusal, not a default.** The app's
 * own screens format in the business's IANA zone, which comes from the session
 * — and this page has no session. The payload carries instants and no zone at
 * all (contract §3.4), so there are three options and only one of them is
 * honest:
 *
 *   - the *reader's* zone, which shifts a due date by a day for anyone west of
 *     the business and makes the same link say different things to different
 *     people;
 *   - a guessed business zone, which is inventing data;
 *   - the instant exactly as the payload writes it, which is what this does.
 *
 * Dates are written by the app as midnight in the business's zone, so reading
 * them back in UTC can land on the previous calendar day for a business east of
 * Greenwich. That is a known, bounded inaccuracy — and it is the same for every
 * reader, which the alternative is not. Fixing it properly needs `timezone` on
 * the public payload, which is a backend change; it is written up in
 * `docs/findings/slice5-projects.md`.
 *
 * `<time dateTime>` carries the unmodified instant for anything that parses the
 * page, so nothing is lost by the display choice.
 *
 * It goes through `formatDate` rather than a local `Intl` call so that a date
 * reads identically here and inside the app — `Intl` with `month: "short"`
 * renders September as "Sept" while `date-fns`' `MMM` renders "Sep", and a
 * client comparing the shared page against a quote would notice.
 */
function PublicDate({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const label = formatDate(date, PUBLIC_TIME_ZONE);

  return (
    <time dateTime={value} className={cn("font-mono", className)}>
      {label}
    </time>
  );
}

/** `18 Aug 2026 → 18 Sep 2026`, or whichever half exists. */
function PublicDateRange({
  startDate,
  dueDate,
}: {
  startDate: string | null;
  dueDate: string | null;
}) {
  if (!startDate && !dueDate) return null;

  return (
    <span className="flex items-center gap-1.5 font-mono text-[12px] text-muted-foreground">
      {startDate ? (
        <PublicDate value={startDate} className="text-[12px]" />
      ) : null}
      {startDate && dueDate ? <span aria-hidden="true">→</span> : null}
      {dueDate ? <PublicDate value={dueDate} className="text-[12px]" /> : null}
    </span>
  );
}
