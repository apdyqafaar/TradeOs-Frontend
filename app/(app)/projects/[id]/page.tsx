import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { ProjectDetail } from "@/features/projects/components/project-detail";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Project",
};

/**
 * One project (design canvas artboard `2l`, the middle panel).
 *
 * A Server Component that does exactly one thing: await the route param and
 * hand the id down. Everything on the screen is a query — the project, its
 * updates, the customer's name, the business timezone, the caller's permissions
 * — so the client boundary starts at `<ProjectDetail>`.
 *
 * `params` is a **Promise** in this version of Next; awaiting it is not
 * optional (`node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`,
 * "Creating a dynamic segment"). Reading `params.id` directly compiles under
 * older type definitions and is `undefined` here. It is typed by hand rather
 * than through the generated `PageProps<'/projects/[id]'>` helper, which
 * `next dev` / `next build` / `next typegen` writes into
 * `.next/types/routes.d.ts` — a typecheck run before the next build would fail
 * on a route literal that does not exist yet.
 *
 * **No `ROUTE_PERMISSIONS` row was added for this sub-route and none is
 * needed.** `resolveRoutePermission` matches the longest guarded prefix on a
 * `/` boundary, so `/projects/<id>` inherits `projects:view` from `/projects`.
 * A row here would be a second copy of the same fact, and the wrong place to
 * put a stricter one: the screen's *controls* are gated individually
 * (`projects:update` for Edit and the update composer, `projects:delete` for
 * Delete, `projects:publish` for the whole share card), because a member with
 * only `projects:view` is meant to read this page.
 *
 * The title stays the static word "Project". Naming it would mean fetching on
 * the server with the session cookie, and nothing in this app fetches that way;
 * a tab title is not worth being the first thing that does.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  const { id } = await params;

  return <ProjectDetail projectId={id} />;
}
