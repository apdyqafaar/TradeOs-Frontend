import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { ReportsHub } from "@/features/reports/components/reports-hub";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Reports",
};

/**
 * The reports hub (design canvas artboard `2i`).
 *
 * Stays a Server Component holding the metadata and the gate: the period lives
 * in the URL and every control below is interactive, so the client boundary
 * starts at `ReportsHub`.
 *
 * `/reports` is already in `config/routes.ts` gated on `reports:view`, and the
 * five sub-pages inherit that row by longest-prefix match. None of them needs
 * a row of its own: all twelve `GET /reports*` endpoints run on that one
 * permission (`docs/contracts/reports.md` §0), so a stricter row would gate a
 * screen more tightly than the request that fills it — the opposite of the two
 * deliberate exceptions (`/team`, `/settings`) already in that map.
 */
export default async function Reports() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout. See
  // `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <ReportsHub />;
}
