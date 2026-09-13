import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { DigestDetail } from "@/features/insights/components/digest-detail";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Digest",
};

/**
 * One digest, by id — `/insights/:id`.
 *
 * `params` is a **Promise** in this version of Next; awaiting it is not
 * optional (`node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`,
 * "Creating a dynamic segment").
 *
 * **No `ROUTE_PERMISSIONS` row was added for this sub-route and none is
 * needed.** `resolveRoutePermission` matches the longest guarded prefix on a
 * `/` boundary, so `/insights/<id>` inherits `reports:view` from `/insights`.
 */
export default async function DigestPage({
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

  return <DigestDetail id={id} />;
}
