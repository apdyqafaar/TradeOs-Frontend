import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { SalesPage } from "@/features/sales/components/sales-page";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Sales",
};

/**
 * The sales journal (brief §6.4, design canvas artboard `2b`'s list sibling).
 *
 * Stays a Server Component holding only the metadata: the list is filtered
 * from the URL and paged client-side, so the client boundary starts at
 * `SalesPage` rather than here.
 *
 * `/sales` is already in `config/routes.ts` gated on `sales:view`, so nothing
 * needed adding there for this page to appear in the sidebar.
 */
export default async function Sales() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <SalesPage />;
}
