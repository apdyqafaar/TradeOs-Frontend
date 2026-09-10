import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { AnnouncementsPage } from "@/features/announcements/components/announcements-page";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Announcements",
};

/**
 * The announcements feed (design canvas artboard `2m`, left panel).
 *
 * `/announcements` is deliberately absent from `ROUTE_PERMISSIONS` —
 * `config/routes.ts` lists it among the paths open to every member, and the
 * contract proves why: `announcements:view` is held by all three presets, the
 * Seller included (`Backend/src/lib/permissions.ts:133`, verified in
 * `docs/contracts/projects-announcements.md` §5). Adding a row would gate a
 * page nobody can fail, and would be one more place to be wrong.
 *
 * `requirePageAccess()` is still awaited, because it is what proves there is a
 * session at all before anything renders; with no row in the map it resolves no
 * permission and `permitted` comes back true for any signed-in member.
 *
 * Stays a Server Component holding only the metadata: the feed pages from the
 * URL and every control on it is gated on the client session, so the client
 * boundary starts at `<AnnouncementsPage>` — the same shape `/debts` and
 * `/customers` use.
 */
export default async function Announcements() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <AnnouncementsPage />;
}
