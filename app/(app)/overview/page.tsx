import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { OverviewScreen } from "@/features/dashboard/components/overview";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * The Overview (brief §6.3, design canvas artboards `1c`, `1d` and `1e`).
 *
 * Stays a Server Component: it holds the metadata and nothing else. The whole
 * screen is one `GET /dashboard` plus the session's first name, so the client
 * boundary starts at `OverviewScreen` rather than here — a `"use client"` on a
 * page drags its entire subtree into the bundle for no gain.
 */
export default async function OverviewPage() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <OverviewScreen />;
}
