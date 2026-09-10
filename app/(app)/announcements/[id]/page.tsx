import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { AnnouncementDetail } from "@/features/announcements/components/announcement-detail";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Announcement",
};

/**
 * One announcement, read (design canvas artboard `2m`, the reading layout).
 *
 * A Server Component that does exactly one thing: await the route param and
 * hand the id down. Everything on the screen is a query — the announcement, the
 * business timezone, the caller's permissions — so the client boundary starts
 * at `<AnnouncementDetail>`.
 *
 * `params` is a **Promise** in this version of Next; awaiting it is not
 * optional (`node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`,
 * "Creating a dynamic segment"). Reading `params.id` directly compiles under
 * older type definitions and is `undefined` here. It is typed by hand rather
 * than through the generated `PageProps<'/announcements/[id]'>` helper, which
 * `next dev` / `next build` / `next typegen` writes into
 * `.next/types/routes.d.ts` — a typecheck run before the next build would fail
 * on a route literal that does not exist yet.
 *
 * **No `ROUTE_PERMISSIONS` row was added, and that is the correct answer for
 * this sub-route rather than an omission.** `resolveRoutePermission` matches the
 * longest guarded prefix on a `/` boundary, so `/announcements/<id>` inherits
 * from `/announcements` — which is deliberately unguarded, because
 * `announcements:view` is held by every preset (contract §5). A row here would
 * gate a page no member can fail.
 *
 * The title stays the static word "Announcement". Naming the notice would mean
 * fetching on the server with the session cookie, and nothing in this app
 * fetches that way; a tab title is not worth being the first thing that does.
 */
export default async function AnnouncementPage({
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

  return <AnnouncementDetail announcementId={id} />;
}
