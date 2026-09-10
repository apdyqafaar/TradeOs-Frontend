import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { DebtsPage } from "@/features/debts/components/debts-page";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Debts",
};

/**
 * The debt book (brief §6.5, design canvas artboard `2f`).
 *
 * Stays a Server Component holding only the metadata: the list is filtered from
 * the URL by its status tabs and paged client-side, so the client boundary
 * starts at `DebtsPage` rather than here — the same shape `/sales` and
 * `/customers` use.
 *
 * `/debts` is already in `config/routes.ts` gated on `debts:view`, so nothing
 * needed adding there for this page to appear in the sidebar; `/debts/<id>`
 * inherits that row by longest-prefix match.
 */
export default async function Debts() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <DebtsPage />;
}
