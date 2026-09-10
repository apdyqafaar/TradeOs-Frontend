"use client";

import { cn } from "cn";
import { ChevronLeft, ChevronRight, FolderKanban, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { parseAsInteger, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { useProjects } from "../hooks/use-projects";
import { PROJECT_STATUSES, type ProjectStatus } from "../types";
import { ProjectCard } from "./project-card";
import { ProjectFormSheet } from "./project-form-sheet";
import { projectStatusLabel } from "./project-status-badge";

/**
 * The whole URL state of this screen: a page and a status.
 *
 * `listProjectsQuerySchema` accepts `page`, `limit`, `status` and `customerId`,
 * `.strict()` (contract §1.1) — so **there is no search box on this page**, and
 * that is a constraint rather than an omission: `?search=x` is a 422
 * `Unrecognized key`, and a client-side filter over one page of twenty would
 * confidently lie about the pages it cannot see.
 *
 * `customerId` is a legal filter and is deliberately not wired to a control.
 * Nothing on this screen can name a customer (see `project-card.tsx`), so a
 * picker here would be a dropdown of ids. It stays available to the hook for
 * whoever builds a customer's project list on the customer screen.
 *
 * `"all"` rather than an absent value for the status default, because `nuqs`
 * needs a concrete default to know when to drop the key from the URL — the
 * hook receives `undefined` instead, which is what makes the server not filter.
 *
 * `history: "replace"` so paging does not stack a back-button entry per page.
 */
const STATUS_OPTIONS = ["all", ...PROJECT_STATUSES] as const;

const FILTER_PARSERS = {
  page: parseAsInteger.withDefault(1),
  status: parseAsStringLiteral(STATUS_OPTIONS).withDefault("all"),
};

/** How many card skeletons to draw. The artboard shows a 2×2 grid. */
const SKELETON_COUNT = 4;

const CONTROL =
  "h-10 rounded-[10px] border border-border bg-card px-3 text-[13px] text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * The projects grid — artboard `2l`, top-left panel.
 *
 * Every list state brief §8.4 asks for is handled: a loading skeleton, an empty
 * state, a *filtered*-empty state with a way to clear the filter, an error card
 * carrying the request id, and a 403.
 *
 * The sixth state — a domain 409 shown where the action was taken — has nothing
 * to attach to on this screen. The feature's only 409 is `ALREADY_PUBLISHED`,
 * and publishing happens on the detail screen, which is where it is handled.
 *
 * **The order is the server's and cannot be changed**: `{ createdAt: -1, _id:
 * -1 }`, newest first, with no `sort` param. A project whose due date is
 * tomorrow sits wherever its creation date puts it.
 */
export function ProjectsPage() {
  const router = useRouter();
  const [{ page, status }, setFilters] = useQueryStates(FILTER_PARSERS, {
    history: "replace",
  });

  const canCreate = useCan(PERMISSIONS.PROJECTS_CREATE);
  const [composing, setComposing] = useState(false);

  /*
   * Only the timezone. Every card shows a due date, and a due date is the
   * business's day — a job due "Friday" in Nairobi is due Friday for the shop,
   * whoever is reading. The cards are held back until it lands rather than
   * rendered against the "UTC" fallback, which is a real zone and would
   * therefore look correct while being wrong.
   *
   * No currency: there is no money anywhere in this feature.
   */
  const { timezone, isLoading: organizationLoading } = useOrganization();

  const { data, error, isPending, isPlaceholderData, refetch } = useProjects({
    page,
    // `undefined`, not `"all"`: the filter is applied only when truthy on the
    // server (`project.actions.ts:65-70`), and `status=all` would be a 422
    // against the five-member enum.
    status: status === "all" ? undefined : (status as ProjectStatus),
  });

  // A 403 is not a failure to retry: nothing broke, the caller simply may not
  // read this. The page is already gated server-side on `projects:view`, so
  // arriving here means the session's permissions changed mid-visit.
  if (error?.status === 403) return <ForbiddenScreen />;

  const items = data?.items ?? [];
  const meta = data?.meta;
  const loading = isPending || organizationLoading;
  const filtered = status !== "all";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-[32px] text-foreground leading-[1.1]">
            Projects
          </h1>
          {meta ? (
            <span className="font-mono text-[13px] text-muted-foreground">
              {meta.total}
            </span>
          ) : null}
        </div>

        <div className="flex gap-2.5">
          <label className="sr-only" htmlFor="project-status-filter">
            Status
          </label>
          <select
            id="project-status-filter"
            value={status}
            onChange={(event) =>
              void setFilters({
                status: event.target.value as (typeof STATUS_OPTIONS)[number],
                // Back to page 1: page 3 of "all" is very unlikely to exist
                // under a narrower filter, and landing on an empty page reads
                // as "there are none" rather than as "you were paged past the
                // end".
                page: 1,
              })
            }
            className={CONTROL}
          >
            <option value="all">All statuses</option>
            {PROJECT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {projectStatusLabel(value)}
              </option>
            ))}
          </select>

          {/*
            Hidden, never disabled (brief §1.1). The Seller preset holds
            `projects:view` but not `projects:create` (contract §5), and a
            seller does not need to learn that starting a project is a thing
            this product does.

            `useCan` rather than `<PermissionGate>` because that component
            renders nothing while the session loads, which would pop the button
            in after the heading has settled.
          */}
          {canCreate ? (
            <Button
              className="h-10 rounded-[10px] px-4 text-[13px]"
              onClick={() => setComposing(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              New project
            </Button>
          ) : null}
        </div>
      </header>

      {error ? (
        <ErrorCard
          error={error}
          title="Couldn't load the projects"
          retry={() => {
            void refetch();
          }}
        />
      ) : null}

      {/*
        A failure with nothing cached renders the card alone. An empty grid
        under it would read as "this business has no projects" rather than "we
        could not ask".
      */}
      {error && !data ? null : loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder cards with no identity of their own, never reordered
              key={index}
              className="h-[276px] w-full rounded-[10px]"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No projects with that status"
            description="Nothing in this business is sitting at that stage right now."
            icon={FolderKanban}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void setFilters({ status: "all", page: 1 })}
              >
                Show all statuses
              </Button>
            }
          />
        ) : page > 1 ? (
          <EmptyState
            title="Nothing on this page"
            description="Projects were removed while this page was open."
            icon={FolderKanban}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void setFilters({ page: 1 })}
              >
                Back to the newest
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No projects yet"
            description="A fit-out, a repair, a build — anything with a start, an end and a client who wants to know how it is going."
            icon={FolderKanban}
            action={
              canCreate ? (
                <Button onClick={() => setComposing(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  New project
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div
          className={cn(
            "grid gap-4 transition-opacity sm:grid-cols-2",
            // Stale cards stay on screen while the next page loads, dimmed
            // rather than blanked — `keepPreviousData` in the hook is what
            // makes that possible.
            isPlaceholderData && "opacity-60",
          )}
        >
          {items.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              timezone={timezone}
            />
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 ? (
        <nav
          aria-label="Project pages"
          className="flex items-center justify-between gap-3"
        >
          <span className="font-mono text-[12px] text-muted-2">
            Page {meta.page} of {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1 || isPlaceholderData}
              onClick={() => void setFilters({ page: meta.page - 1 })}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Newer
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages || isPlaceholderData}
              onClick={() => void setFilters({ page: meta.page + 1 })}
            >
              Older
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : null}

      {/*
        One sheet, mounted only for someone who may use it. Creating navigates
        straight to the new project — the share card, the updates and the edit
        controls all live on the detail screen, and somebody who has just
        started a project is usually about to publish it.
      */}
      {canCreate ? (
        <ProjectFormSheet
          open={composing}
          onOpenChange={setComposing}
          onSaved={(project) => router.push(ROUTES.project(project.id))}
        />
      ) : null}
    </div>
  );
}
